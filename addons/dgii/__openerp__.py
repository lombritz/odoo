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



# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4:

{
    'name': 'Reportes DGII',
    'version': '1.0',
    'category': 'Accountant',
    'sequence': 7,
    'summary': 'Reportes de Impuestos Internos RD',
    'description': """
Modulo generador de los reportes de la DGII
===========================================

Este modulo espera solucionar la generacion de los reportes:

* 606
* IRS
* Otros
    """,
    'author': 'Wilton Beltre',
    'depends': ['l10n_do'],
    'website': 'http://www.ab-tec.net',
    'update_xml':  ['dgii_view.xml'],
    'installable': True,
    'auto_install': False,
}
