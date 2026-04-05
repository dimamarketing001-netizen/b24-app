/**
 * Финальная, рабочая версия скрипта.
 * Вся логика обернута в BX24.ready(), чтобы гарантировать,
 * что все компоненты портала, включая UI, полностью загружены.
 */
BX24.ready(function() {
    console.log("BX24 is ready. Application logic starts.");

    // Инициализация календаря Flatpickr
    flatpickr("#first_payment_date", {
        locale: "ru",
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d.m.Y",
    });

    const form = document.getElementById('payment-form');
    const addPaymentBtn = document.getElementById('add-payment-btn');
    const addPaymentRow = document.getElementById('add-payment-row');
    let specialPaymentCounter = 0;
    const MAX_SPECIAL_PAYMENTS = 3;

    addPaymentBtn.addEventListener('click', () => {
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

        if (specialPaymentCounter >= MAX_SPECIAL_PAYMENTS) {
            addPaymentBtn.style.display = 'none';
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

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

            if (!confirmChange) {
                alert('Тип сделки не изменен. Отправка графика отменена.');
                return;
            }

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
});
