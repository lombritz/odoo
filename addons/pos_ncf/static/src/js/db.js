function openerp_pos_ncf_db(instance, module) { //module is instance.point_of_sale
    var QWeb = instance.web.qweb,
        _t = instance.web._t;

    module.PosDB = module.PosDB.extend({
        init: function (options) {
            var self = this;
            this._super(options);

            this.pending_order_sorted = [];
            this.pending_order_by_id = {};
            this.pending_order_by_ncf = {};
            this.pending_order_search_string = "";
            this.pending_order_write_date = null;


            this.pending_orderlines_by_orderid = {};
            this.pending_paymentlines_by_orderid = {};

            this.product_templates_by_id = {};
        },

        add_product_template: function(product_template) {
            this.product_templates_by_id[product_template.id] = product_template;
        },

        add_pending_orderlines: function(order, orderlines) {
            this.pending_orderlines_by_orderid[order.id] = orderlines;
        },

        get_pending_orderlines_by_order_id: function(order) {
            return this.pending_orderlines_by_orderid[order.id];
        },

        add_pending_paymentlines: function(order, paymentlines) {
            this.pending_paymentlines_by_orderid[order.id] = paymentlines;
        },

        get_pending_paymentlines_by_order_id: function(order) {
            return this.pending_paymentlines_by_orderid[order.id];
        },

        add_pending_orders: function (orders) {
            var updated_count = 0;
            for (var i = 0, len = orders.length; i < len; i++) {
                var order = orders[i];
                if (this.pending_order_by_id[order.id]) {
                    continue;
                } else {
                    this.pending_order_sorted.push(order.id);
                }
                this.pending_order_by_id[order.id] = order;
                updated_count += 1;
            }

            if (updated_count) {
                // If there were updates, we need to completely
                // rebuild the search string and the NCF indexing

                this.pending_order_search_string = "";
                this.pending_order_by_ncf = {};

                for (var id in this.pending_order_by_id) {
                    var order = this.pending_order_by_id[id];
                    this.pending_order_by_ncf[order.x_ncf] = order;
                    this.pending_order_search_string += this._pending_order_search_string(order);
                }
            }
            return updated_count;
        },

        get_pending_orders_sorted: function (max_count) {
            max_count = max_count ? Math.min(this.pending_order_sorted.length, max_count) : this.pending_order_sorted.length;
            var pending_orders = [];
            for (var i = 0; i < max_count; i++) {
                pending_orders.push(this.pending_order_by_id[this.pending_order_sorted[i]]);
            }
            //console.log(pending_orders);
            return pending_orders;
        },

        _pending_order_search_string: function (order) {
            var str = '' + order.id + ':' + order.get('name');
            var client = order.get('client');
            if(client) {
                str += '|' + client.name;
                str += '|' + client.phone;
            }
            return str + '\n';
        },

        get_product_template_by_id: function(id) {
            return this.product_templates_by_id[id];
        },

        get_pending_order_by_id: function (id) {
            return this.pending_order_by_id[id];
        },

        get_pending_order_write_date: function () {
            return this.pending_order_write_date;
        },

        search_pending_order: function (query) {
            try {
                query = query.replace(/[\[\]\(\)\+\*\?\.\-\!\&\^\$\|\~\_\{\}\:\,\\\/]/g, '.');
                query = query.replace(' ', '.+');
                var re = RegExp("([0-9]+):.*?" + query, "gi");
            } catch (e) {
                return [];
            }
            var results = [];
            for (var i = 0; i < this.limit; i++) {
                r = re.exec(this.pending_order_search_string);
                if (r) {
                    var id = Number(r[1]);
                    results.push(this.get_pending_order_by_id(id));
                } else {
                    break;
                }
            }
            return results;
        }
    });
}