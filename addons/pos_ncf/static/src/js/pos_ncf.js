
// this file contains the screens definitions. Screens are the
// content of the right pane of the pos, containing the main functionalities. 
// screens are contained in the PosWidget, in pos_widget.js
// all screens are present in the dom at all time, but only one is shown at the
// same time. 
//
// transition between screens is made possible by the use of the screen_selector,
// which is responsible of hiding and showing the screens, as well as maintaining
// the state of the screens between different orders.
//
// all screens inherit from ScreenWidget. the only addition from the base widgets
// are show() and hide() which shows and hides the screen but are also used to 
// bind and unbind actions on widgets and devices. The screen_selector guarantees
// that only one screen is shown at the same time and that show() is called after all
// hide()s

function openerp_pos_ncf(instance, module){ //module is instance.point_of_sale
    var QWeb = instance.web.qweb,

    _t = instance.web._t;

    module.ReceiptScreenWidget = module.ScreenWidget.extend({
        template: 'ReceiptScreenWidget',

        show_numpad:     false,
        show_leftpane:   false,

        show: function(){
            this._super();
            var self = this;

            var print_button = this.add_action_button({
                    label: _t('Print'),
                    icon: '/point_of_sale/static/src/img/icons/png48/printer.png',
                    click: function() { self.print(); }
                });

            var finish_button = this.add_action_button({
                    label: _t('Next Order'),
                    icon: '/point_of_sale/static/src/img/icons/png48/go-next.png',
                    click: function() { self.finishOrder(); }
                });

            var sequence = new openerp.Model('ir.sequence');
            var code = 'cr.consumidor.final';

            // TODO: select sequenceName based on partner_id.fiscal_position

            var _this = this;

            sequence.call('next_by_code', [code]).then(function(ncf) {

                var order = _this.pos.get('selectedOrder');

                console.log(order.id);
                console.log(order.get('client').id);


                /*
                TODO:
                    - get partner rnc.
                    - get partner fiscal position.
                    - calculate ncf type.
                    - get next ncf based on type.
                    - update por.order ncf field.
                    - Done!
                */






                console.log("RNC: " + order.x_rnc);
                console.log("NCF: " + ncf);

                // TODO: set NCF to order and save it.

                _this.refresh();

                if (!order._printed) {
                    _this.print();
                }

                //
                // The problem is that in chrome the print() is asynchronous and doesn't
                // execute until all rpc are finished. So it conflicts with the rpc used
                // to send the orders to the backend, and the user is able to go to the next
                // screen before the printing dialog is opened. The problem is that what's
                // printed is whatever is in the page when the dialog is opened and not when it's called,
                // and so you end up printing the product list instead of the receipt...
                //
                // Fixing this would need a re-architecturing
                // of the code to postpone sending of orders after printing.
                //
                // But since the print dialog also blocks the other asynchronous calls, the
                // button enabling in the setTimeout() is blocked until the printing dialog is
                // closed. But the timeout has to be big enough or else it doesn't work
                // 2 seconds is the same as the default timeout for sending orders and so the dialog
                // should have appeared before the timeout... so yeah that's not ultra reliable.

                finish_button.set_disabled(true);
                setTimeout(function(){
                    finish_button.set_disabled(false);
                }, 2000);
            });
        },
        print: function() {
            this.pos.get('selectedOrder')._printed = true;
            window.print();
        },
        finishOrder: function() {
            this.pos.get('selectedOrder').destroy();
        },
        refresh: function() {
            var order = this.pos.get('selectedOrder');
            console.log("order id: " + order.get('client').id);
            var partner = new instance.Model('res.partner');
            partner.query(['x_rnc'])
                .filter([['id','=',order.get('client').id]])
                .limit(1).all().then(function(p) {
                    console.log(p);
                    //p ? console.log(p.x_rnc) : "no partner";
                });

            $('.pos-receipt-container', this.$el).html(QWeb.render('PosTicket',{
                    widget:this,
                    order: order,
                    orderlines: order.get('orderLines').models,
                    paymentlines: order.get('paymentLines').models,
                    rnc: order.get('x_rnc'),
                    ncf: order.get('x_ncf')
                }));
        },
        close: function(){
            this._super();
        }
    });

}
