BX24.ready(function() {
    console.log("BX24 is ready. Application logic starts.");

    // --- Инициализация ---
    flatpickr("#first_payment_date", {
        locale: "ru",
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d.m.Y",
    });

    const form = document.getElementById('payment-form');
    const addPaymentBtn = document.getElementById('add-payment-btn');
    const addPaymentRow = document.getElementById('add-payment-row');
    const missingFieldsContainer = document.getElementById('missing-fields-container');
    const errorContainer = document.getElementById('error-message-container');
    
    let specialPaymentCounter = 0;
    const MAX_SPECIAL_PAYMENTS = 3;
    let contactIdToUpdate = null; // Сохраняем ID контакта для обновления

    // --- Логика кастомного модального окна ---
    const modal = document.getElementById('custom-modal');
    const modalText = document.getElementById('modal-text');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    function showCustomConfirm(text) {
        return new Promise(resolve => {
            modalText.textContent = text;
            modal.style.display = 'flex';
            confirmBtn.onclick = () => { modal.style.display = 'none'; resolve(true); };
            cancelBtn.onclick = () => { modal.style.display = 'none'; resolve(false); };
        });
    }

    // --- Основные функции ---
    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }

    function hideError() {
        errorContainer.style.display = 'none';
    }

    function renderMissingFields(fields) {
        missingFieldsContainer.innerHTML = ''; // Очищаем контейнер
        fields.forEach(field => {
            const fieldRow = document.createElement('div');
            fieldRow.classList.add('ui-form-row');
            fieldRow.innerHTML = `
                <div class="ui-form-label">
                    <div class="ui-ctl-label-text">${field.name}</div>
                </div>
                <div class="ui-form-content">
                    <div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                        <input type="text" class="ui-ctl-element missing-field-input" data-field-code="${field.code}" required>
                    </div>
                </div>
            `;
            missingFieldsContainer.appendChild(fieldRow);
        });
    }

    async function handleFormSubmit() {
        hideError();
        const dealId = document.getElementById('deal_id').value;

        // --- ЭТАП 1: Проверка и дозаполнение обязательных полей ---
        const missingInputs = document.querySelectorAll('.missing-field-input');
        if (missingInputs.length > 0) {
            const fieldsToUpdate = {};
            let allFilled = true;
            missingInputs.forEach(input => {
                if (input.value) {
                    fieldsToUpdate[input.dataset.fieldCode] = input.value;
                } else {
                    allFilled = false;
                }
            });

            if (!allFilled) {
                showError("Пожалуйста, заполните все обязательные поля.");
                return;
            }

            // Отправляем данные на бэкенд для обновления
            const updateRes = await fetch('/api/update_fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_id: contactIdToUpdate, fields: fieldsToUpdate }),
            });

            if (!updateRes.ok) {
                showError("Не удалось сохранить данные. Попробуйте еще раз.");
                return;
            }
            
            missingFieldsContainer.innerHTML = ''; // Очищаем поля после сохранения
        }

        // --- ЭТАП 2: Проверка, нужно ли показывать поля ---
        const checkRes = await fetch('/api/check_fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deal_id: dealId }),
        });

        if (!checkRes.ok) {
            showError("Не удалось проверить поля в Битрикс24.");
            return;
        }

        const checkData = await checkRes.json();
        if (checkData.missing_fields && checkData.missing_fields.length > 0) {
            contactIdToUpdate = checkData.contact_id;
            showError("Не заполнены обязательные поля. Пожалуйста, заполните их и нажмите 'Сформировать' еще раз.");
            renderMissingFields(checkData.missing_fields);
            return; // Останавливаем выполнение, ждем второго нажатия
        }

        // --- ЭТАП 3: Основная логика (если все поля заполнены) ---
        const selectedDealTypeId = document.getElementById('deal_type_select').value;
        const currentDealTypeId = document.getElementById('current_deal_type_id').value;

        if (selectedDealTypeId !== currentDealTypeId) {
            const confirmChange = await showCustomConfirm('Тип сделки в форме отличается от текущего. Изменить тип?');
            if (!confirmChange) {
                alert('Тип сделки не изменен. Отправка графика отменена.');
                return;
            }
            // ... (логика обновления типа сделки)
        }

        // --- ЭТАП 4: Сбор данных и создание графика ---
        const specialPayments = Array.from(document.querySelectorAll('.special-payment-input'))
            .map(input => parseFloat(input.value)).filter(v => !isNaN(v));

        const formData = {
            deal_id: dealId,
            total_amount: document.getElementById('total_amount').value,
            monthly_payments: document.getElementById('monthly_payments').value,
            first_payment_date: document.getElementById('first_payment_date').value,
            special_payments: specialPayments,
            selected_deal_type_id: selectedDealTypeId
        };

        try {
            const response = await fetch('/api/create_payment_schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (response.ok) {
                BX24.closeApplication();
            } else {
                const errorData = await response.json();
                showError(`Ошибка: ${errorData.error}`);
            }
        } catch (error) {
            showError('Произошла ошибка при отправке данных.');
        }
    }

    // --- Привязка обработчиков ---
    addPaymentBtn.addEventListener('click', () => {
        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) return;
        specialPaymentCounter++;
        const newPaymentRow = document.createElement('div');
        newPaymentRow.classList.add('ui-form-row');
        newPaymentRow.innerHTML = `
            <div class="ui-form-label"><div class="ui-ctl-label-text">Сумма ${specialPaymentCounter}-го платежа</div></div>
            <div class="ui-form-content"><div class="ui-ctl ui-ctl-textbox ui-ctl-w100"><input type="number" class="ui-ctl-element special-payment-input" required></div></div>
        `;
        addPaymentRow.parentNode.insertBefore(newPaymentRow, addPaymentRow);
        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) addPaymentBtn.style.display = 'none';
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        handleFormSubmit();
    });
});
