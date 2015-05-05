function openerp_pos_ncf_widgets(instance, module) { //module is instance.point_of_sale
    var QWeb = instance.web.qweb;
    var _t = instance.web._t;

    module.OrderButtonWidget = module.OrderButtonWidget.extend({
        renderElement: function () {
            this._super();

            var self = this;
            this.$el.unbind('click');
            this.$el.bind('click', function() {
                var selected = (self.pos.get('selectedOrder') === self.order);
                var ss = self.pos.pos_widget.screen_selector;
                if ( !selected ) {
                    self.selectOrder();
                } else {
                    if ( ss.get_current_screen() === 'clientlist' ){
                        ss.back();
                    } else if ( ss.get_current_screen() !== 'receipt' && ss.get_current_screen() !== 'orderlist' ){
                        ss.set_current_screen('clientlist');
                    }
                }
            });
        }
    });

    module.PosWidget = module.PosWidget.extend({
        // This method instantiates all the screens, widgets, etc. If you want to add new screens change the
        // startup screen, etc, override this method.
        build_widgets: function () {
            var self = this;
            this._super();

            if (self.pos.config.x_allow_pending_order) {
                // --------  New Screens definitions.
                this.orderlist_screen = new module.PendingOrderListScreenWidget(this, {});
                this.orderlist_screen.appendTo(this.$('.screens'));

                // -------- Misc.
                this.pendingorders_button = new module.HeaderButtonWidget(this, {
                    label: _t('Ordenes Pendientes'),
                    action: function () {
                        self.screen_selector.set_current_screen('orderlist', {}, true);
                    }
                });
                this.pendingorders_button.appendTo(this.$('.pos-rightheader'));

                // --------  Adding Pending Order Screen to screen_selector.
                this.screen_selector.add_screen('orderlist', this.orderlist_screen);
            }
        }
    });
}