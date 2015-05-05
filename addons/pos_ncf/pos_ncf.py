# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) 2004-2010 Tiny SPRL (<http://tiny.be>).
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU Affero General Public License as
#    published by the Free Software Foundation, either version 3 of the
#    License, or (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU Affero General Public License for more details.
#
#    You should have received a copy of the GNU Affero General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################
import logging
import time
import datetime

from openerp import tools, models, fields
from openerp.osv import osv
from openerp.tools.translate import _

_logger = logging.getLogger(__name__)


class PosOrder(models.Model):
    _inherit = 'pos.order'

    state = fields.Selection(selection=[('draft', 'New'),
                                        ('cancel', 'Cancelled'),
                                        ('pending', 'Pendiente'),
                                        ('paid', 'Paid'),
                                        ('done', 'Posted'),
                                        ('invoiced', 'Invoiced')],
                             string='Status', readonly=True, copy=False)

    x_ncf = fields.Char(string='NCF')

    x_delivery_date = fields.Datetime(string='Fecha de entrega')

    x_pending_order_id = fields.Integer(string='Id de Orden Pendiente')

    x_express_order = fields.Boolean(string='Servicio Expreso')

    def _order_fields(self, cr, uid, ui_order, context=None):
        return {
            'name': ui_order['name'],
            'user_id': ui_order['user_id'] or False,
            'session_id': ui_order['pos_session_id'],
            'lines': ui_order['lines'],
            'pos_reference': ui_order['name'],
            'partner_id': ui_order['partner_id'] or False,
            'x_ncf': ui_order['x_ncf'] or False,
            'x_delivery_date': datetime.datetime.strptime(ui_order['x_delivery_date'], "%d/%m/%Y %I:%M %p") or False,
            'x_pending_order_id': ui_order['x_pending_order_id'] or False,
            'x_express_order': ui_order['x_express_order'] or False
        }

    def test_paid(self, cr, uid, ids, context=None):
        for order in self.browse(cr, uid, ids, context=context):
            if order.lines and not order.amount_total:
                return True
            if order.x_express_order and order.amount_paid > order.amount_total:
                return True
            if (not order.lines) or (not order.statement_ids) or \
                    (abs(order.amount_total - order.amount_paid) > 0.00001):
                return False
        return True

    def create_from_ui(self, cr, uid, orders, context=None):
        # Keep only new orders
        submitted_references = [o['data']['name'] for o in orders]
        existing_order_ids = self.search(cr, uid, [('pos_reference', 'in', submitted_references)], context=context)
        existing_orders = self.read(cr, uid, existing_order_ids, ['pos_reference'], context=context)
        existing_references = set([o['pos_reference'] for o in existing_orders])
        orders_to_save = [o for o in orders if o['data']['name'] not in existing_references]

        order_ids = []

        for tmp_order in orders_to_save:
            to_invoice = tmp_order['to_invoice']
            order = tmp_order['data']
            order_id = self.create(cr, uid, self._order_fields(cr, uid, order, context=context),context)

            if order['x_pending_order_id']:
                pending_order = self.pool.get('pos.order').browse(cr, uid, order['x_pending_order_id'], context=context)
                if pending_order.session_id.state == 'closed':
                    pending_order.write({'state': 'done'})
                elif pending_order.session_id.state == 'opened':
                    pending_order.write({'state': 'paid'})
                else:
                    pending_order.write({'state': 'paid'})


            wkf_signal = 'paid'

            for payments in order['statement_ids']:
                # If journal is pending payment then put order to pending status.
                if self.pool.get('account.journal').browse(cr, uid, payments[2]['journal_id'], context=context).x_pending_payment:
                    wkf_signal = 'pending'
                self.add_payment(cr, uid, order_id, self._payment_fields(cr, uid, payments[2], context=context), context=context)

            session = self.pool.get('pos.session').browse(cr, uid, order['pos_session_id'], context=context)
            if session.sequence_number <= order['sequence_number']:
                session.write({'sequence_number': order['sequence_number'] + 1})
                session.refresh()

            if order['amount_return'] and round(order['amount_return']) > 0:
                cash_journal = session.cash_journal_id
                if not cash_journal:
                    cash_journal_ids = filter(lambda st: st.journal_id.type=='cash', session.statement_ids)
                    if not len(cash_journal_ids):
                        raise osv.except_osv( _('error!'),
                                              _("No cash statement found for this session. Unable to record returned cash."))
                    for payments in order['statement_ids']:
                        temp_cash_journal = self.pool.get('account.journal').browse(cr, uid, payments[2]['journal_id'], context=context)
                        if temp_cash_journal.type == 'cash':
                            cash_journal = temp_cash_journal
                self.add_payment(cr, uid, order_id, {
                    'amount': -order['amount_return'],
                    'payment_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                    'payment_name': _('return'),
                    'journal': cash_journal.id,
                    }, context=context)
            order_ids.append(order_id)

            try:
                self.signal_workflow(cr, uid, [order_id], wkf_signal)
            except Exception as e:
                _logger.error('Could not fully process the POS Order: %s', tools.ustr(e))

            if to_invoice:
                self.action_invoice(cr, uid, [order_id], context)
                order_obj = self.browse(cr, uid, order_id, context)
                self.pool['account.invoice'].signal_workflow(cr, uid, [order_obj.invoice_id.id], 'invoice_open')

        return order_ids

    def action_pending(self, cr, uid, ids, context=None):
        self.write(cr, uid, ids, {'state': 'pending'}, context=context)
        # self.create_account_move(cr, uid, ids, context=context)
        return True


class PosConfig(models.Model):
    _inherit = 'pos.config'

    x_ncf_sequences = fields.One2many(comodel_name='ir.sequence', inverse_name='x_pos_config_id', auto_join=True)
    x_partner_required = fields.Boolean(string='Cliente es requerido?')
    x_allow_pending_order = fields.Boolean(string='Cobrar ordenes pendientes?', help='Esta funcionalidad requiere ordenes pendientes de pago en el TPV, por lo que debe existir al menos un TPV con un metodo de pago pendiente.')


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _confirm_orders(self, cr, uid, ids, context=None):
        account_move_obj = self.pool.get('account.move')
        pos_order_obj = self.pool.get('pos.order')
        for session in self.browse(cr, uid, ids, context=context):
            local_context = dict(context or {}, force_company=session.config_id.journal_id.company_id.id)
            order_ids = [order.id for order in session.order_ids if order.state == 'paid']

            move_id = account_move_obj.create(cr, uid, {'ref' : session.name, 'journal_id' : session.config_id.journal_id.id, }, context=local_context)

            pos_order_obj._create_account_move_line(cr, uid, order_ids, session, move_id, context=local_context)

            for order in session.order_ids:
                if order.state == 'done':
                    continue
                if order.state not in ('paid', 'invoiced', 'pending'):
                    raise osv.except_osv(
                        _('Error!'),
                        _("You cannot confirm all orders of this session, because they have not the 'paid' status"))
                else:
                    pos_order_obj.signal_workflow(cr, uid, [order.id], 'done')

        return True


class AccounJournal(models.Model):
    _inherit = 'account.journal'

    x_pending_payment = fields.Boolean(string='Genera orden pendiente?')
    x_post_payment = fields.Boolean(string='Pospago de ordenes pendientes?')


class IrSequence(models.Model):
    _inherit = 'ir.sequence'

    x_ncf = fields.Boolean(string='NCF?')
    x_dn = fields.Char(string='División de Negocio')
    x_pe = fields.Char(string='Punto de Emisión')
    x_ai = fields.Char(string='Area de Impresión')
    x_tcf = fields.Char(string='Tipo de Comprobante Fiscal')

    x_pos_config_id = fields.Many2one(comodel_name='pos.config', string='TPV')

class ProductTemplate(models.Model):
    _inherit = 'product.template'

    x_express_price = fields.Float(string='Precio Expreso')