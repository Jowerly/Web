(() => {
  const storage = {
    read(key) {
      try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false; // p. ej. cuota de localStorage excedida
      }
    },
  };

  function showStatus(form, message, type = 'success') {
    let status = form.querySelector('.form-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'form-status';
      status.setAttribute('aria-live', 'polite');
      form.append(status);
    }
    status.textContent = message;
    status.dataset.type = type;
  }

  function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function normalize(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  // Lee una imagen, la reduce y la devuelve como data URL JPEG liviana.
  function resizeImage(file, maxSize = 600, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; // fondo para PNG con transparencia
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function configureMobileMenu() {
    const toggle = document.querySelector('.menu-toggle');
    const button = document.querySelector('.menu-toggle-button');
    if (!toggle || !button) return;

    const updateMenuState = () => button.setAttribute('aria-expanded', String(toggle.checked));
    toggle.addEventListener('change', updateMenuState);
    document.querySelectorAll('.menu-movil-lista a').forEach((link) => {
      link.addEventListener('click', () => { toggle.checked = false; updateMenuState(); });
    });
    updateMenuState();
  }

  function configureSubscriptions() {
    document.querySelectorAll('.footer-subscribe-form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const email = form.querySelector('input[type="email"]');
        if (!(email instanceof HTMLInputElement) || !email.checkValidity()) {
          email?.reportValidity();
          return;
        }
        const saved = storage.read('sayriSubscriptions');
        const normalizedEmail = email.value.trim().toLowerCase();
        if (saved.some((entry) => entry.email === normalizedEmail)) {
          showStatus(form, 'Este correo ya está registrado.', 'info');
          return;
        }
        saved.push({ email: normalizedEmail, createdAt: new Date().toISOString() });
        storage.write('sayriSubscriptions', saved);
        form.reset();
        showStatus(form, '¡Gracias! Tu suscripción fue registrada en este navegador.');
      });
    });
  }

  function configureContactForm() {
    const form = document.querySelector('.formcontacto');
    if (!(form instanceof HTMLFormElement)) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      const messages = storage.read('sayriMessages');
      messages.push({ ...data, createdAt: new Date().toISOString() });
      storage.write('sayriMessages', messages);
      form.reset();
      showStatus(form, 'Mensaje enviado. Gracias por compartir tu idea con SAYRI PERU.');
    });
  }

  // Un solo modal; usa delegación de eventos para que también funcione
  // con las tarjetas que se renderizan dinámicamente.
  function configureRecipeDetails() {
    if (!document.querySelector('#grid-oficiales, #grid-comunidad')) return;

    const modal = document.createElement('dialog');
    modal.className = 'recipe-dialog';
    modal.innerHTML = `
      <button class="recipe-dialog-close" type="button" aria-label="Cerrar detalle">×</button>
      <p class="recipe-dialog-eyebrow">Detalle de receta</p>
      <h2></h2>
      <p class="recipe-dialog-description"></p>
      <p class="recipe-dialog-note">Consejo: adapta la cantidad de café y endulzante a tu gusto.</p>
    `;
    document.body.append(modal);
    modal.querySelector('.recipe-dialog-close')?.addEventListener('click', () => modal.close());

    const openRecipe = (card) => {
      const title = card.querySelector('h3')?.textContent?.trim() ?? 'Receta SAYRI';
      const description = card.querySelector('.receta-info p')?.textContent?.trim() ?? 'Una propuesta para disfrutar tu café.';
      const tags = [...card.querySelectorAll('.tag')].map((tag) => tag.textContent?.trim()).filter(Boolean).join(' · ');
      modal.querySelector('h2').textContent = title;
      modal.querySelector('.recipe-dialog-description').textContent = `${description} ${tags ? `(${tags})` : ''}`;
      modal.showModal();
    };

    document.addEventListener('click', (event) => {
      const card = event.target.closest?.('.receta-card');
      if (card) openRecipe(card);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest?.('.receta-card');
      if (card && event.target === card) {
        event.preventDefault();
        openRecipe(card);
      }
    });
  }

  // --- GESTOR DE RECETAS OFICIALES Y COMUNIDAD ---
  function configureSplitRecipes() {
    const btnOficiales = document.querySelector('[data-tab="oficiales"]');
    const btnComunidad = document.querySelector('[data-tab="comunidad"]');
    const panelOficiales = document.querySelector('#panel-oficiales');
    const panelComunidad = document.querySelector('#panel-comunidad');

    const gridOficiales = document.querySelector('#grid-oficiales');
    const gridComunidad = document.querySelector('#grid-comunidad');
    const buscadorOficiales = document.querySelector('#buscador-oficiales');
    const buscadorComunidad = document.querySelector('#buscador-comunidad');
    const formComunidad = document.querySelector('#form-nueva-receta');
    const fileInput = document.querySelector('#recipe-file');

    if (!gridOficiales || !gridComunidad) return;

    const DEFAULT_IMG = 'Assets/recetas/edited.png';

    // 1. Recetas oficiales fijas
    const defaultRecipes = [
      { title: 'Café de canela', description: 'Una taza aromática para las tardes frías.', category: 'Caliente', time: '15 min', diff: 'Intermedio', img: 'Assets/recetas/edited.png' },
      { title: 'Frappé de algarrobina', description: 'Cremoso, fresco y listo para compartir.', category: 'Fría', time: '15 min', diff: 'Intermedio', img: 'Assets/recetas/edited2.png' },
      { title: 'Mousse de café', description: 'Una alternativa suave con sabor intenso.', category: 'Postre', time: '20 min', diff: 'Intermedio', img: 'Assets/recetas/edited3.png' },
      { title: 'Tiramisú casero', description: 'Capas dulces para cerrar una buena comida.', category: 'Postre', time: '25 min', diff: 'Intermedio', img: 'Assets/recetas/edited_t.png' },
      { title: 'Blueberry ice latte', description: 'Una mezcla fría, cremosa y frutal.', category: 'Fría', time: '10 min', diff: 'Fácil', img: 'Assets/recetas/edited_b.png' },
      { title: 'Mojito de café', description: 'Cítrico, fresco y con un giro diferente.', category: 'Fría', time: '10 min', diff: 'Fácil', img: 'Assets/recetas/edited_m.png' },
    ];

    // Una sola plantilla de tarjeta para ambos paneles
    function cardHTML(recipe) {
      return `
        <article class="receta-card" tabindex="0" role="button" aria-label="Ver detalle de ${escapeHTML(recipe.title)}">
          <img src="${escapeHTML(recipe.img || DEFAULT_IMG)}" alt="${escapeHTML(recipe.title)}">
          <div class="receta-info">
            <div class="receta-tags">
              <span class="tag tag-categoria">${escapeHTML(recipe.category)}</span>
              <span class="tag tag-tiempo">${escapeHTML(recipe.time)}</span>
              <span class="tag tag-dificultad">${escapeHTML(recipe.diff || 'Fácil')}</span>
            </div>
            <h3>${escapeHTML(recipe.title)}</h3>
            <p>${escapeHTML(recipe.description)}</p>
          </div>
        </article>
      `;
    }

    function matchesFilter(recipe, query) {
      return (
        normalize(recipe.title).includes(query) ||
        normalize(recipe.description).includes(query) ||
        normalize(recipe.category).includes(query)
      );
    }

    function renderOficiales(filter = '') {
      const query = normalize(filter);
      const filtered = defaultRecipes.filter((r) => matchesFilter(r, query));

      gridOficiales.innerHTML = filtered.length
        ? filtered.map(cardHTML).join('')
        : '<p class="no-results-msg">No se encontraron recetas oficiales.</p>';
    }

    function renderComunidad(filter = '') {
      const saved = storage.read('sayriCustomRecipes');
      const query = normalize(filter);
      const filtered = saved.filter((r) => matchesFilter(r, query));

      if (filtered.length) {
        gridComunidad.innerHTML = filtered.map(cardHTML).join('');
      } else if (saved.length) {
        gridComunidad.innerHTML = '<p class="no-results-msg">No se encontraron recetas de la comunidad con ese término.</p>';
      } else {
        gridComunidad.innerHTML = '<p class="no-results-msg">Aún no hay recetas creadas por la comunidad. ¡Sé el primero en agregar una!</p>';
      }
    }

    // 2. Pestañas
    function showTab(name) {
      const isOficiales = name === 'oficiales';
      btnOficiales?.classList.toggle('active', isOficiales);
      btnComunidad?.classList.toggle('active', !isOficiales);
      btnOficiales?.setAttribute('aria-selected', String(isOficiales));
      btnComunidad?.setAttribute('aria-selected', String(!isOficiales));
      if (panelOficiales) panelOficiales.style.display = isOficiales ? 'block' : 'none';
      if (panelComunidad) panelComunidad.style.display = isOficiales ? 'none' : 'block';
      if (!isOficiales) renderComunidad(buscadorComunidad?.value ?? '');
    }

    btnOficiales?.addEventListener('click', () => showTab('oficiales'));
    btnComunidad?.addEventListener('click', () => showTab('comunidad'));

    // 3. Buscadores (uno por pestaña)
    buscadorOficiales?.addEventListener('input', (event) => renderOficiales(event.target.value));
    buscadorComunidad?.addEventListener('input', (event) => renderComunidad(event.target.value));

    // 4. Formulario exclusivo para la comunidad (con foto opcional)
    formComunidad?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!formComunidad.reportValidity()) return;

      const submitButton = formComunidad.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;

      try {
        const formData = new FormData(formComunidad);
        const file = fileInput?.files?.[0];
        let img = DEFAULT_IMG;

        if (file) {
          if (!file.type.startsWith('image/')) {
            showStatus(formComunidad, 'El archivo seleccionado no es una imagen.', 'error');
            return;
          }
          img = await resizeImage(file);
        }

        const saved = storage.read('sayriCustomRecipes');
        saved.push({
          title: formData.get('title').trim(),
          description: formData.get('description').trim(),
          category: formData.get('category').trim(),
          time: formData.get('time').trim(),
          diff: 'Fácil',
          img,
        });

        if (!storage.write('sayriCustomRecipes', saved)) {
          showStatus(formComunidad, 'No hay espacio en el navegador para guardar la receta. Prueba con una imagen más pequeña.', 'error');
          return;
        }

        formComunidad.reset();
        showStatus(formComunidad, file ? '¡Receta e imagen publicadas en la comunidad!' : '¡Receta publicada con éxito en la comunidad!');
        renderComunidad(buscadorComunidad?.value ?? '');
      } catch (error) {
        showStatus(formComunidad, error.message || 'No se pudo procesar la imagen.', 'error');
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });

    // Carga inicial
    renderOficiales();
    renderComunidad();
  }

  configureMobileMenu();
  configureSubscriptions();
  configureContactForm();
  configureRecipeDetails();
  configureSplitRecipes();
})();