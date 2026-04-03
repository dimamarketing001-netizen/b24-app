document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded. Starting application script.");

    let bx24Initialized = false;

    // Устанавливаем таймер, чтобы проверить, инициализировался ли BX24.
    setTimeout(() => {
        if (!bx24Initialized) {
            console.error("КРИТИЧЕСКАЯ ОШИБКА: BX24.init() не завершился в течение 3 секунд. Окружение портала Битрикс24 нестабильно. Функциональность приложения будет нарушена.");
            alert("Ошибка: Не удалось инициализировать окружение Битрикс24. Функциональность приложения нарушена. Пожалуйста, попробуйте очистить кэш браузера или использовать другой браузер.");
        }
    }, 3000);

    // Весь код приложения должен выполняться после инициализации API Битрикс24
    BX24.init(function() {
        bx24Initialized = true;
        console.log("BX24 успешно инициализирован. Привязка обработчиков событий...");

        // Инициализация календаря Flatpickr
        try {
            flatpickr("#first_payment_date", {
                locale: "ru",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d.m.Y",
            });
            console.log("Flatpickr инициализирован.");
        } catch (e) {
            console.error("Не удалось инициализировать Flatpickr:", e);
        }

        const form = document.getElementById('payment-form');
        const addPaymentBtn = document.getElementById('add-payment-btn');
        const addPaymentRow = document.getElementById('add-payment-row');
        let specialPaymentCounter = 0;
        const MAX_SPECIAL_PAYMENTS = 3;

        if (!form || !addPaymentBtn || !addPaymentRow) {
            console.error("Не удалось найти один или несколько обязательных элементов формы.");
            return;
        }

        addPaymentBtn.addEventListener('click', () => {
            console.log("Нажата кнопка 'Добавить особенный платеж'.");

            if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) {
                return;
            }

            specialPaymentCounter++;
            const newPaymentRow = document.createElement('div');
            newPaymentRow.classList.add('ui-form-row');
            newPaymentRow.innerHTML = `
                <div class="ui-form-label">
                    <div class="ui-ctl-label-text">Сумма ${specialPaymentCounter}-го платежа</div>
                </div>
                <div class="ui-form-content">
                    <div class="ui-ctl ui-ctl-textbox ui-ctl-w100">
                        <input type="number" class="ui-ctl-element special-payment-input" required>
                    </div>
                </div>
            `;
            addPaymentRow.parentNode.insertBefore(newPaymentRow, addPaymentRow);
            console.log("Новая строка платежа добавлена в DOM.");

            if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) {
                addPaymentBtn.style.display = 'none';
            }
        });

        form.addEventListener('submit', async (event) => {
            console.log("Сработало событие отправки формы.");
            event.preventDefault();
            console.log("Стандартная отправка формы отменена.");

            const selectedDealTypeId = document.getElementById('deal_type_select').value;
            const currentDealTypeId = document.getElementById('current_deal_type_id').value;
            const dealId = document.getElementById('deal_id').value;

            if (selectedDealTypeId !== currentDealTypeId) {
                const confirmChange = await new Promise(resolve => {
                    BX24.callMethod(
                        'ui.dialogs.messagebox.show',
                        {
                            message: 'Тип сделки в форме отличается от текущего в сделке. Изменить тип сделки?',
                            buttons: BX24.UI.Dialogs.MessageBoxButtons.YES_NO,
                            onYes: () => resolve(true),
                            onNo: () => resolve(false)
                        }
                    );
                });

                if (confirmChange) {
                    try {
                        const updateResponse = await fetch('/api/update_deal_type', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ deal_id: dealId, new_type_id: selectedDealTypeId }),
                        });
                        if (!updateResponse.ok) {
                            const errorData = await updateResponse.json();
                            alert(`Ошибка при изменении типа сделки: ${errorData.error}`);
                            return;
                        }
                    } catch (error) {
                        console.error('Ошибка при запросе на изменение типа сделки:', error);
                        alert('Произошла ошибка при изменении типа сделки.');
                        return;
                    }
                } else {
                    alert('Тип сделки не изменен. Отправка графика отменена.');
                    return;
                }
            }

            const specialPayments = [];
            document.querySelectorAll('.special-payment-input').forEach(input => {
                if (input.value) {
                    specialPayments.push(parseFloat(input.value));
                }
            });

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
                    alert(`Ошибка: ${errorData.error}`);
                }
            } catch (error) {
                console.error('Объект ошибки из блока catch:', error);
                alert('Произошла ошибка при отправке данных.');
            }
        });

        console.log("Все обработчики событий успешно привязаны.");
    });
});
