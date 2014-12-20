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


{
    'name': 'Point Of Sale DR',
    'version': '1.0',
    'category': 'Point of Sale',
    'sequence': 7,
    'summary': 'Dominican extension for the Point of Sale',
    'description': """
Point Of Sale DR
=======================

This module adds Dominican regulation requirements to the Point of Sale:

* Bill template with RNC and NCF.
* NCF type selection.
* NCF generation based on type.
    """,
    'author': 'Jaime Rojas',
    'depends': ['point_of_sale','l10n_do'],
    'website': 'https://www.codefirstlab.com',
    'data': [
        'data/pos_ncf_workflow.xml',
        'views/ir_sequence_view.xml',
        'views/pos_ncf_config.xml',
        'views/pos_ncf_payments.xml',
        'views/templates.xml',
    ],
    'qweb':[
        'static/src/xml/pos_ncf.xml',
    ],
    'installable': True,
    'auto_install': False,
}

# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4:
