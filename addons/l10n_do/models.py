# -*- coding: utf-8 -*-
from openerp import fields, models


class AccountInvoice(models.Model):
	_inherit = 'account.invoice'

	x_vat = fields.Char(related='partner_id.vat', store=True)
