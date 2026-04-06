BX24.ready(function() {
    console.log("BX24 is ready. Application logic starts.");

    // --- Инициализация ---
    flatpickr("#first_payment_date", { locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y" });

    const form = document.getElementById('payment-form');
    const addPaymentBtn = document.getElementById('add-payment-btn');
    const addPaymentRow = document.getElementById('add-payment-row');
    const errorContainer = document.getElementById('error-message-container');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const loaderOverlay = document.getElementById('loader-overlay');
    
    // Контейнеры для полей. Контейнер для даты рождения теперь создается динамически.
    const requisiteContainer = document.getElementById('requisite-fields-container');
    const regAddressContainer = document.getElementById('registration-address-container');
    const physAddressContainer = document.getElementById('physical-address-container');

    let requisiteIdToUpdate = null;
    let contactIdForCreation = null;
    let specialPaymentCounter = 0;
    const MAX_SPECIAL_PAYMENTS = 3;
    
    let fieldsAreDisplayed = false;

    // --- Вспомогательные функции ---
    function showLoader() { loaderOverlay.style.display = 'flex'; }
    function hideLoader() { loaderOverlay.style.display = 'none'; }
    function showError(message) { errorContainer.textContent = message; errorContainer.style.display = 'block'; }
    function hideError() { errorContainer.style.display = 'none'; }

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

    /**
     * Рендерит поле даты рождения. Если контейнер не существует, создает его.
     */
    function renderBirthdateField(birthdateValue, isComplete) {
        let container = document.getElementById('birthdate-container');

        // Если поле заполнено, просто скрываем контейнер, если он вдруг есть
        if (isComplete) {
            if (container) {
                container.innerHTML = '';
                container.style.display = 'none';
            }
            return;
        }

        // Если поле НЕ заполнено, создаем контейнер, если его нет
        if (!container) {
            container = document.createElement('div');
            container.id = 'birthdate-container';
            container.className = 'fields-group';
            // Вставляем его перед контейнером реквизитов
            if (requisiteContainer) {
                requisiteContainer.parentNode.insertBefore(container, requisiteContainer);
            } else {
                form.appendChild(container); // Запасной вариант
            }
        }
        
        container.innerHTML = `
            <div class="ui-form-title">
                <div class="ui-form-title-text">Дата рождения (из Контакта)</div>
            </div>
        `;
        container.style.display = 'block';

        const inputId = 'input_birthdate';
        let value = birthdateValue || '';
        if (value.includes('T')) {
            value = value.split('T')[0];
        }
        const isError = !value.trim();
        const errorClass = isError ? 'field-error' : '';

        const fieldRow = document.createElement('div');
        fieldRow.classList.add('ui-form-row');
        fieldRow.innerHTML = `
            <div class="ui-form-label"><div class="ui-ctl-label-text">Дата рождения</div></div>
            <div class="ui-form-content"><div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                <input type="text" id="${inputId}" class="ui-ctl-element missing-field-input ${errorClass}" data-field-code="BIRTHDATE" value="${value}" required>
            </div></div>
        `;
        container.appendChild(fieldRow);
        flatpickr(`#${inputId}`, { 
            locale: "ru", 
            dateFormat: "Y-m-d", 
            altInput: true, 
            altFormat: "d.m.Y",
            allowInput: true
        });
    }

    function renderFields(fieldsData, container, fieldDefinitions) {
        const wrapper = container.querySelector('.fields-wrapper') || container;
        wrapper.innerHTML = '';
        
        const fieldsToRender = Object.keys(fieldDefinitions);

        if (fieldsToRender.length > 0) {
            container.style.display = 'block';
            fieldsToRender.forEach(code => {
                const name = fieldDefinitions[code];
                let value = fieldsData[code] || '';
                const isError = !value.trim();
                const errorClass = isError ? 'field-error' : '';

                if (code === 'RQ_IDENT_DOC_DATE' && value.includes('T')) {
                    value = value.split('T')[0];
                }

                const fieldRow = document.createElement('div');
                fieldRow.classList.add('ui-form-row');
                
                const inputId = `input_${code}_${Math.random().toString(36).substr(2, 9)}`; 
                let inputHtml = `<input type="text" id="${inputId}" class="ui-ctl-element missing-field-input ${errorClass}" data-field-code="${code}" value="${value}" required>`;

                fieldRow.innerHTML = `
                    <div class="ui-form-label"><div class="ui-ctl-label-text">${name}</div></div>
                    <div class="ui-form-content"><div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                        ${inputHtml}
                    </div></div>
                `;
                wrapper.appendChild(fieldRow);

                if (code === 'RQ_IDENT_DOC_DATE') {
                    flatpickr(`#${inputId}`, { 
                        locale: "ru", 
                        dateFormat: "Y-m-d",
                        altInput: true, 
                        altFormat: "d.m.Y",
                        allowInput: true
                    });
                }
            });
        } else {
            container.style.display = 'none';
        }
    }
    
    function collectFields(containerSelector) {
        const fields = {};
        let allFilled = true;
        const inputs = document.querySelectorAll(`${containerSelector} input.missing-field-input`);
        inputs.forEach(input => {
            const value = input.value.trim();
            fields[input.dataset.fieldCode] = value;
            if (!value) {
                allFilled = false;
            }
        });
        return { fields, allFilled };
    }

    async function createSchedule() {
        const dealId = document.getElementById('deal_id').value;
        const selectedDealTypeId = document.getElementById('deal_type_select').value;
        const currentDealTypeId = document.getElementById('current_deal_type_id').value;

        if (selectedDealTypeId !== currentDealTypeId) {
            const confirmChange = await showCustomConfirm('Тип сделки в форме отличается от текущего. Изменить тип?');
            if (!confirmChange) {
                alert('Тип сделки не изменен. Отправка графика отменена.');
                return;
            }
            
            showLoader();
            try {
                const updateResponse = await fetch('/api/update_deal_type', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deal_id: dealId, new_type_id: selectedDealTypeId }),
                });
                if (!updateResponse.ok) {
                    const errorData = await updateResponse.json();
                    showError(`Ошибка при изменении типа сделки: ${errorData.error}`);
                    hideLoader();
                    return;
                }
            } catch (error) {
                console.error('Ошибка при запросе на изменение типа сделки:', error);
                showError('Произошла ошибка при изменении типа сделки.');
                hideLoader();
                return;
            }
        } else {
            showLoader();
        }

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
        } finally {
            hideLoader();
        }
    }

    // --- Главный обработчик формы ---
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideError();
        
        try {
            if (fieldsAreDisplayed) {
                showLoader();
                const requisiteData = collectFields('#requisite-fields-container');
                const registrationAddressData = collectFields('#registration-address-container');
                const physicalAddressData = collectFields('#physical-address-container');
                const birthdateInput = document.querySelector('#birthdate-container input.missing-field-input');
                const birthdateValue = birthdateInput ? birthdateInput.value.trim() : '';

                let allRequiredFieldsFilled = requisiteData.allFilled && registrationAddressData.allFilled && physicalAddressData.allFilled;
                if (birthdateInput && !birthdateValue) {
                    allRequiredFieldsFilled = false;
                }

                if (!allRequiredFieldsFilled) {
                    showError("Пожалуйста, заполните все обязательные поля.");
                    document.querySelectorAll('.missing-field-input').forEach(input => {
                        if (!input.value.trim()) input.classList.add('field-error');
                    });
                    hideLoader();
                    return;
                }

                const updatePayload = { 
                    requisite_id: requisiteIdToUpdate, 
                    contact_id: contactIdForCreation,
                    requisite_fields: requisiteData.fields,
                    registration_address: registrationAddressData.fields,
                    physical_address: physicalAddressData.fields
                };
                if (birthdateInput) {
                    updatePayload.birthdate = birthdateValue;
                }


                const updateRes = await fetch('/api/update_fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatePayload),
                });

                if (!updateRes.ok) {
                    showError("Не удалось сохранить данные. Попробуйте еще раз.");
                    hideLoader();
                    return;
                }
                hideLoader();
            }
            
            showLoader();
            const dealId = document.getElementById('deal_id').value;
            const checkRes = await fetch('/api/check_fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deal_id: dealId }),
            });

            if (!checkRes.ok) {
                const errorData = await checkRes.json();
                showError(errorData.error || "Не удалось проверить поля в Битрикс24.");
                hideLoader();
                return;
            }
            hideLoader();

            const checkData = await checkRes.json();

            if (checkData.is_complete) {
                const birthdateContainer = document.getElementById('birthdate-container');
                if (birthdateContainer) {
                    birthdateContainer.style.display = 'none';
                }
                requisiteContainer.innerHTML = '';
                regAddressContainer.style.display = 'none';
                physAddressContainer.style.display = 'none';
                hideError();
                fieldsAreDisplayed = false;
                
                await createSchedule();
            } else {
                requisiteIdToUpdate = checkData.requisite_id;
                contactIdForCreation = checkData.contact_id;
                
                let messages = [];
                if (!checkData.is_birthdate_complete) {
                    messages.push("Не заполнена дата рождения в контакте.");
                }
                if (!checkData.requisite_id) {
                     messages.push("У контакта нет реквизитов.");
                } else if (Object.values(checkData.data.requisite_fields).some(v => !v) || Object.values(checkData.data.registration_address).some(v => !v) || Object.values(checkData.data.physical_address).some(v => !v)) {
                    messages.push("Не все поля в реквизитах или адресах заполнены.");
                }

                showError("Необходимо дозаполнить данные: " + messages.join(' '));

                renderBirthdateField(checkData.data.birthdate, checkData.is_birthdate_complete);
                renderFields(checkData.data.requisite_fields, requisiteContainer, checkData.definitions.requisite_fields);
                renderFields(checkData.data.registration_address, regAddressContainer, checkData.definitions.address_fields);
                renderFields(checkData.data.physical_address, physAddressContainer, checkData.definitions.address_fields);
                
                fieldsAreDisplayed = true;
            }

        } catch (error) {
            showError('Произошла критическая ошибка. Пожалуйста, проверьте консоль.');
            console.error(error);
            hideLoader();
        } 
    });

    // --- Остальные обработчики ---
    document.addEventListener('input', function(event) {
        if (event.target.classList.contains('missing-field-input')) {
            if (event.target.value.trim()) {
                event.target.classList.remove('field-error');
            }
        }
    });

    copyAddressBtn.addEventListener('click', () => {
        const regInputs = document.querySelectorAll('#registration-address-container input.missing-field-input');
        regInputs.forEach(regInput => {
            const fieldCode = regInput.dataset.fieldCode;
            const physInput = document.querySelector(`#physical-address-container input[data-field-code="${fieldCode}"]`);
            if (physInput) {
                physInput.value = regInput.value;
                if (physInput.value.trim()) {
                    physInput.classList.remove('field-error');
                }
            }
        });
    });
    
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
});
