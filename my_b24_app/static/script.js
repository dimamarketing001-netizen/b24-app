BX24.ready(function() {
    console.log("BX24 is ready. Application logic starts.");

    // --- Инициализация ---
    flatpickr("#first_payment_date", { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });

    const form = document.getElementById('payment-form');
    const loaderOverlay = document.getElementById('loader-overlay');
    // ... (остальные переменные)

    // --- Функции загрузчика ---
    function showLoader() {
        loaderOverlay.style.display = 'flex';
    }

    function hideLoader() {
        loaderOverlay.style.display = 'none';
    }

    // ... (логика модального окна)

    async function handleFormSubmit() {
        hideError();
        showLoader(); // <--- ПОКАЗАТЬ ЗАГРУЗЧИК

        try {
            const dealId = document.getElementById('deal_id').value;

            // --- ЭТАП 1: Сбор и отправка данных для обновления ---
            const missingInputs = document.querySelectorAll('.missing-field-input');
            if (missingInputs.length > 0) {
                // ... (логика сбора полей)

                const updateRes = await fetch('/api/update_fields', { /* ... */ });
                if (!updateRes.ok) {
                    showError("Не удалось сохранить данные. Попробуйте еще раз.");
                    return; // Важно: не забываем return
                }
            }

            // --- ЭТАП 2: Повторная проверка полей ---
            const checkRes = await fetch('/api/check_fields', { /* ... */ });
            if (!checkRes.ok) {
                showError("Не удалось проверить поля в Битрикс24.");
                return;
            }

            const checkData = await checkRes.json();
            // ... (логика рендеринга недостающих полей)

            if (checkData.missing_fields.length > 0 || /* ... */) {
                showError("Не заполнены все обязательные поля...");
                return;
            }

            // --- ЭТАП 3: Основная логика (если все поля заполнены) ---
            // ... (логика смены типа сделки)

            // --- ЭТАП 4: Сбор данных и создание графика ---
            const formData = { /* ... */ };
            const response = await fetch('/api/create_payment_schedule', { /* ... */ });
            
            if (response.ok) {
                BX24.closeApplication();
            } else {
                const errorData = await response.json();
                showError(`Ошибка: ${errorData.error}`);
            }

        } catch (error) {
            showError('Произошла критическая ошибка. Пожалуйста, проверьте консоль.');
            console.error(error);
        } finally {
            hideLoader(); // <--- СКРЫТЬ ЗАГРУЗЧИК В ЛЮБОМ СЛУЧАЕ
        }
    }

    // ... (остальные обработчики)

    // Первичная проверка при загрузке
    handleFormSubmit();
});
