/* Copyright(c) 2017-2021 Philip Mulcahy. */

'use strict';

import * as date from './date';
import * as azad_entity from './entity';
import * as notice from './notice';
import * as extraction from './extraction';
import * as signin from './signin';
import * as sprintf from 'sprintf-js';
import * as dom2json from './dom2json';
import * as request_scheduler from './request_scheduler';
import * as urls from './url';
import * as util from './util';
import * as item from './item';

function getField(
    xpath: string,
    elem: HTMLElement,
    context: string
): string|null {
    try {
        const valueElem = util.findSingleNodeValue(xpath, elem, context);
        return valueElem!.textContent!.trim();
    } catch (_) {
        return null;
    }
}

function getAttribute(
    xpath: string,
    attribute_name: string,
    elem: HTMLElement,
    context: string,
): string|null {
    try {
        const targetElem = util.findSingleNodeValue(xpath, elem, context);
        return (<HTMLElement>targetElem)!.getAttribute(attribute_name);
    } catch (_) {
        return null;
    }
}

function getCachedAttributeNames() {
    return new Set<string>(['class', 'href', 'id', 'style']);
}

function getCacheExcludedElementTypes() {
    return new Set<string>(['img']);
}

interface IOrderDetails {
    date: Date|null;
    total: string;
    postage: string;
    postage_refund: string;
    gift: string;
    us_tax: string;
    vat: string;
    gst: string;
    pst: string;
    refund: string;
    who: string;
    invoice_url: string;

    [index: string]: string|Date|null;
};

function extractDetailFromDoc(
    order: OrderImpl, doc: HTMLDocument
): IOrderDetails {
    const context = 'id:' + order.id;
    const who = function(){
        if(order.who) {
            return order.who;
        }

        const doc_elem = doc.documentElement;

        let x = getField(
            // TODO: this seems brittle, depending on the precise path of the element.
            '//table[contains(@class,"sample")]/tbody/tr/td/div/text()[2]',
            doc_elem,
            context
        ); // US Digital
        if(x) return x;

        x = getField('.//div[contains(@class,"recipient")]' +
            '//span[@class="trigger-text"]', doc_elem, context);
        if(x) return x;

        x = getField(
            './/div[contains(text(),"Recipient")]',
            doc_elem,
            context
        );
        if(x) return x;

        x = getField(
            '//li[contains(@class,"displayAddressFullName")]/text()',
            doc_elem,
            context,
        );

        if ( !x ) {
            x = 'null';
        }

        return x;
    };

    const order_date = function(): Date|null {
        const def_string = order.date ?
            util.dateToDateIsoString(order.date):
            null;
        const d = extraction.by_regex(
            [
                '//*[contains(@class,"order-date-invoice-item")]/text()',
                '//*[contains(@class, "orderSummary")]//*[contains(text(), "Digital Order: ")]/text()',
            ],
            /(?:Ordered on|Commandé le|Digital Order:) (.*)/i,
            def_string,
            doc.documentElement,
            context,
        );
        if (d) {
            return new Date(date.normalizeDateString(d));
        }
        return util.defaulted(order.date, null);
    };

    const total = function(): string {
        const a = extraction.by_regex(
            [
                '//span[@class="a-color-price a-text-bold"]/text()',

                '//b[contains(text(),"Total for this Order")]/text()',

                '//span[contains(@id,"grand-total-amount")]/text()',

                '//div[contains(@id,"od-subtotals")]//' +
                '*[contains(text(),"Grand Total") ' +
                'or contains(text(),"Montant total TTC")' +
                'or contains(text(),"Total général du paiement")' +
                ']/parent::div/following-sibling::div/span',

                '//span[contains(text(),"Grand Total:")]' +
                '/parent::*/parent::*/div/span[' +
                'contains(text(), "$") or ' +
                'contains(text(), "£") or ' +
                'contains(text(), "€") or ' +
                'contains(text(), "AUD") or ' +
                'contains(text(), "CAD") or ' +
                'contains(text(), "GBP") or ' +
                'contains(text(), "USD") ' +
                ']/parent::*/parent::*',

                '//*[contains(text(),"Grand total:") ' +
                'or  contains(text(),"Grand Total:") ' +
                'or  contains(text(),"Total general:")' +
                'or  contains(text(),"Total for this order:")' +
                'or  contains(text(),"Total of this order:")' +
                'or  contains(text(),"Total de este pedido:")' +
                'or  contains(text(),"Total del pedido:")' +
                'or  contains(text(),"Montant total TTC:")' +
                'or  contains(text(),"Total général du paiement:")' +
                ']',

            ],
            null,
            order.total,
            doc.documentElement,
            context,
        );
        if (a) {
            const whitespace = /[\n\t ]/g;
            return a.replace(/^.*:/, '')
                    .replace(/[\n\t ]/g, '')  // whitespace
                    .replace('-', '');
        }
        return util.defaulted(a, '');
    };

    // TODO Need to exclude gift wrap
    const gift = function(): string {
        const a = extraction.by_regex(
            [
                '//div[contains(@id,"od-subtotals")]//' +
                'span[contains(text(),"Gift") or contains(text(),"Importo Buono Regalo")]/' +
                'parent::div/following-sibling::div/span',

                '//span[contains(@id, "giftCardAmount-amount")]/text()', // Whole foods or Amazon Fresh.

                '//*[text()[contains(.,"Gift Certificate")]]',

                '//*[text()[contains(.,"Gift Card")]]',
            ],
            null,
            null,
            doc.documentElement,
            context,
        );
        if ( a ) {
            const b = a.match(
                /Gift (?:Certificate|Card) Amount: *-?([$£€0-9.]*)/i);
            if( b !== null ) {
                return b[1];
            }
            if (/\d/.test(a)) {
                return a.replace('-', '');
            }
        }
        return '';
    };

    const postage = function(): string {
        return util.defaulted(
            extraction.by_regex(
                [
                    ['Postage', 'Shipping', 'Livraison', 'Delivery', 'Costi di spedizione'].map(
                        label => sprintf.sprintf(
                            '//div[contains(@id,"od-subtotals")]//' +
                            'span[contains(text(),"%s")]/' +
                            'parent::div/following-sibling::div/span',
                            label
                        )
                    ).join('|') //20191025
                ],
                null,
                null,
                doc.documentElement,
                context,
            ),
            ''
        );
    };

    const postage_refund = function(): string {
        return util.defaulted(
            extraction.by_regex(
                [
                    ['FREE Shipping'].map(
                        label => sprintf.sprintf(
                            '//div[contains(@id,"od-subtotals")]//' +
                            'span[contains(text(),"%s")]/' +
                            'parent::div/following-sibling::div/span',
                            label
                        )
                    ).join('|') //20191025
                ],
                null,
                null,
                doc.documentElement,
                context,
            ),
            ''
        );
    };

    const vat = function(): string {
        const xpaths = ['VAT', 'tax', 'TVA', 'IVA'].map(
            label =>
                '//div[contains(@id,"od-subtotals")]//' +
                'span[contains(text(), "' + label + '") ' +
                'and not(contains(text(),"Before") or contains(text(), "esclusa") ' +
                ')]/' +
                'parent::div/following-sibling::div/span'
        ).concat(
            [
                '//div[contains(@class,"a-row pmts-summary-preview-single-item-amount")]//' +
                'span[contains(text(),"VAT")]/' +
                'parent::div/following-sibling::div/span',

                '//div[@id="digitalOrderSummaryContainer"]//*[text()[contains(., "VAT: ")]]',
                '//div[contains(@class, "orderSummary")]//*[text()[contains(., "VAT: ")]]'
            ]
        );
        const a = extraction.by_regex(
            xpaths,
            null,
            null,
            doc.documentElement,
            context,
        );
        if( a != null ) {
            const b = a.match(
                /VAT: *([-$£€0-9.]*)/i
            );
            if( b !== null ) {
                return b[1];
            }
        }
        return util.defaulted(a, '');
    };

    const us_tax = function(): string {
        let a = extraction.by_regex(
            [
                '//span[contains(text(),"Estimated tax to be collected:")]/../../div[2]/span/text()',
                '//span[contains(@id, "totalTax-amount")]/text()',
            ],
            util.moneyRegEx(),
            null,
            doc.documentElement,
            context,
        );
        if ( !a ) {
            a = getField(
                './/tr[contains(td,"Tax Collected:")]',
                doc.documentElement,
                context,
            );
            if (a) {
                // Result
                // 0: "Tax Collected: USD $0.00"
                // 1: "USD $0.00"
                // 2:   "USD"
                // 3:   "$0.00"
                // 4:     "$"
                // 5:     "0.00"
                try {
                    // @ts-ignore stop complaining: you're in a try block!
                    a = a.match(util.moneyRegEx())[1];
                } catch {
                    a = null;
                }
            } else {
                a = null;
            }
        }
        return util.defaulted(a, '');
    };

    const cad_gst = function(): string {
        const a = extraction.by_regex(
            [
                ['GST', 'HST'].map(
                    label => sprintf.sprintf(
                        '//div[contains(@id,"od-subtotals")]//' +
                        'span[contains(text(),"%s") and not(contains(.,"Before"))]/' +
                        'parent::div/following-sibling::div/span',
                        label
                    )
                ).join('|'),

                '//*[text()[contains(.,"GST") and not(contains(.,"Before"))]]',

                '//div[contains(@class,"a-row pmts-summary-preview-single-item-amount")]//' +
                'span[contains(text(),"GST")]/' +
                'parent::div/following-sibling::div/span',
            ],
            /(:?VAT:)? *([-$£€0-9.]*)/i,
            null,
            doc.documentElement,
            context,
        );
        return util.defaulted(a, '');
    };

    const cad_pst = function(): string {
        const a = extraction.by_regex(
            [
                ['PST', 'RST', 'QST'].map(
                    label => sprintf.sprintf(
                        '//div[contains(@id,"od-subtotals")]//' +
                        'span[contains(text(),"%s") and not(contains(.,"Before"))]/' +
                        'parent::div/following-sibling::div/span',
                        label
                    )
                ).join('|'),

                '//*[text()[contains(.,"PST") and not(contains(.,"Before"))]]',

                '//div[contains(@class,"a-row pmts-summary-preview-single-item-amount")]//' +
                'span[contains(text(),"PST")]/' +
                'parent::div/following-sibling::div/span',
            ],
            /(VAT: *)([-$£€0-9.]*)/i,
            null,
            doc.documentElement,
            context,
        );
        return util.defaulted(a, '');
    };

    const refund = function (): string {
        let a = getField(
            ['Refund', 'Totale rimborso'].map( //TODO other field names?
                label => sprintf.sprintf(
                    '//div[contains(@id,"od-subtotals")]//' +
                    'span[contains(text(),"%s")]/' +
                    'ancestor::div[1]/following-sibling::div/span',
                    label
                )
            ).join('|'),
            doc.documentElement,
            context,
        );
        return util.defaulted(a, '');
    };

    const invoice_url = function (): string {
        const suffix: string|null = getAttribute(
            '//a[contains(@href, "/invoice")]',
            'href',
            doc.documentElement,
            context,
        );
        if( suffix ) {
            return 'https://' + urls.getSite() + suffix;
        }
        return '';
    };

    const details: IOrderDetails = {
        date: order_date(),
        total: total(),
        postage: postage(),
        postage_refund: postage_refund(),
        gift: gift(),
        us_tax: us_tax(),
        vat: vat(),
        gst: cad_gst(),
        pst: cad_pst(),
        refund: refund(),
        who: who(),
        invoice_url: invoice_url(),
    };

    return details;
}

interface IOrderDetailsAndItems {
    details: IOrderDetails;
    items: item.IItem[];
};

function extractDetailPromise(
    order: OrderImpl,
    scheduler: request_scheduler.IRequestScheduler
): Promise<IOrderDetailsAndItems> {
  return new Promise<IOrderDetailsAndItems>(
    (resolve, reject) => {
        const context = 'id:' + order.id;
        const url = order.detail_url;
        if(!url) {
            const msg = 'null order detail query: cannot schedule';
            console.error(msg);
            reject(msg);
        } else {
            const event_converter = function(
                evt: { target: { responseText: string; }; }
            ): IOrderDetailsAndItems {
                const doc = util.parseStringToDOM( evt.target.responseText );
                return {
                    details: extractDetailFromDoc(order, doc),
                    items: item.extractItems(
                        util.defaulted(order.id, ''),
                        order.date,
                        util.defaulted(order.detail_url, ''),
                        doc.documentElement,
                        context,
                    ),
                };
            };
            try {
                scheduler.scheduleToPromise<IOrderDetailsAndItems>(
                    url,
                    event_converter,
                    util.defaulted(order.id, '9999'),
                    false
                ).then(
                    (response: request_scheduler.IResponse<IOrderDetailsAndItems>) => {
                      resolve(response.result)
                    },
                    url => {
                      const msg = 'scheduler rejected ' + order.id + ' ' + url;
                      console.error(msg);
                      reject('timeout or other problem when fetching ' + url)
                    },
                );
            } catch (ex) {
                const msg = 'scheduler upfront rejected ' + order.id + ' ' + url;
                console.error(msg);
                reject(msg);
            }
        }
    }
  );
}

export interface IOrder extends azad_entity.IEntity {
    id(): Promise<string>;
    detail_url(): Promise<string>;
    invoice_url(): Promise<string>;
    list_url(): Promise<string>;
    payments_url(): Promise<string>;


    date(): Promise<Date|null>;
    gift(): Promise<string>;
    gst(): Promise<string>;
    item_list(): Promise<item.IItem[]>;
    payments(): Promise<string[]>;
    postage(): Promise<string>;
    postage_refund(): Promise<string>;
    pst(): Promise<string>;
    refund(): Promise<string>;
    site(): Promise<string>;
    total(): Promise<string>;
    us_tax(): Promise<string>;
    vat(): Promise<string>;
    who(): Promise<string>;
};

interface ISyncOrder extends azad_entity.IEntity {
    id: string;
    detail_url: string;
    invoice_url: string;
    list_url: string;
    payments_url: string;
    date: Date|null;
    gift: string;
    gst: string;
    item_list: item.IItem[];
    payments: string[];
    postage: string;
    postage_refund: string;
    pst: string;
    refund: string;
    site: string;
    total: string;
    us_tax: string;
    vat: string;
    who: string;
}

class Order {
    impl: OrderImpl;

    constructor(impl: OrderImpl) {
        this.impl = impl
    }

    id(): Promise<string> {
        return Promise.resolve(util.defaulted(this.impl.id, ''));
    }
    list_url(): Promise<string> {
        return Promise.resolve(util.defaulted(this.impl.list_url, ''));
    }
    detail_url(): Promise<string> {
        return Promise.resolve(util.defaulted(this.impl.detail_url, ''));
    }
    payments_url(): Promise<string> {
        return Promise.resolve(util.defaulted(this.impl.payments_url, ''));
    }
    site(): Promise<string> {
        return Promise.resolve(util.defaulted(this.impl.site, ''));
    }
    date(): Promise<Date|null> {
        return Promise.resolve(this.impl.date);
    }
    total(): Promise<string> {
        return this._detail_dependent_promise(detail => detail.total);
    }
    who(): Promise<string> {
        return Promise.resolve(util.defaulted(this.impl.who, ''));
    }
    item_list(): Promise<item.IItem[]> {
        const items: item.IItem[] = [];
        if (this.impl.detail_promise) {
            return this.impl.detail_promise.then( details => {
                details.items.forEach(item => {
                    items.push(item);
                });
                return items;
            });
        } else {
            return Promise.resolve(items);
        }
    }
    payments(): Promise<string[]> {
        return util.defaulted(
            this.impl.payments_promise,
            Promise.resolve([])
        );
    }

    _detail_dependent_promise(
        detail_lambda: (d: IOrderDetails) => string
    ): Promise<string> {
        if (this.impl.detail_promise) {
            return this.impl.detail_promise.then(
                details => detail_lambda(details.details)
            );
        }
        return Promise.resolve('');
    }

    postage(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.postage );
    }
    postage_refund(): Promise<string> {
        return this._detail_dependent_promise(
            detail => detail.postage_refund
        );
    }
    gift(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.gift );
    };
    us_tax(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.us_tax )
    }
    vat(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.vat )
    }
    gst(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.gst )
    }
    pst(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.pst )
    }
    refund(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.refund )
    }
    invoice_url(): Promise<string> {
        return this._detail_dependent_promise( detail => detail.invoice_url )
    }
}

async function sync(order: IOrder): Promise<ISyncOrder> {
    const id = await order.id();
    const detail_url = await order.detail_url();
    const invoice_url = await order.invoice_url();
    const list_url = await order.list_url();
    const payments_url = await order.payments_url();
    const date = await order.date();
    const gift = await order.gift();
    const gst = await order.gst();
    const item_list = await order.item_list();
    const payments = await order.payments();
    const postage = await order.postage();
    const postage_refund = await order.postage_refund();
    const pst = await order.pst();
    const refund = await order.refund();
    const site = await order.site();
    const total = await order.total();
    const us_tax = await order.us_tax();
    const vat = await order.vat();
    const who = await order.who();

    return {
        id: id,
        detail_url: detail_url,
        invoice_url: invoice_url,
        list_url: list_url,
        payments_url: payments_url,
        date: date,
        gift: gift,
        gst: gst,
        item_list: item_list,
        payments: payments,
        postage: postage,
        postage_refund: postage_refund,
        pst: pst,
        refund: refund,
        site: site,
        total: total,
        us_tax: us_tax,
        vat: vat,
        who: who,
    }
}

type DateFilter = (d: Date|null) => boolean;

class OrderImpl {
    id: string|null;
    site: string|null;
    list_url: string|null;
    detail_url: string|null;
    payments_url: string|null;
    invoice_url: string|null;
    date: Date|null;
    total: string|null;
    who: string|null;
    detail_promise: Promise<IOrderDetailsAndItems>|null;
    payments_promise: Promise<string[]>|null;

    constructor(
        ordersPageElem: HTMLElement,
        scheduler: request_scheduler.IRequestScheduler,
        src_query: string,
        date_filter: DateFilter,
    ) {
        this.id = null;
        this.site = null;
        this.list_url = src_query;
        this.detail_url = null;
        this.payments_url = null;
        this.invoice_url = null;
        this.date = null;
        this.total = null;
        this.who = null;
        this.detail_promise = null;
        this.payments_promise = null;
        this._extractOrder(ordersPageElem, date_filter, scheduler);
    }

    _extractOrder(
      elem: HTMLElement,
      date_filter: DateFilter,
      scheduler: request_scheduler.IRequestScheduler
    ) {
        const doc = elem.ownerDocument;

        try {
            this.id = [
                ...Array.prototype.slice.call(elem.getElementsByTagName('a'))
            ].filter( el => el.hasAttribute('href') )
             .map( el => el.getAttribute('href') )
             .map( href => href.match(/.*(?:orderID=|orderNumber%3D)([A-Z0-9-]*).*/) )
             .filter( match => match )[0][1];
        } catch (error) {
            console.warn(
                'could not parse order id from order list page ' + this.list_url
            );
            this.id = 'UNKNOWN_ORDER_ID';
            throw error;
        }

        const context = 'id:' + this.id;

        this.date = null;
        try {
            this.date = new Date(
                date.normalizeDateString(
                    util.defaulted(
                        getField(
                            [
                                'Commande effectuée',
                                'Order placed',
                                'Ordine effettuato',
                                'Pedido realizado'
                            ].map(
                                label => sprintf.sprintf(
                                    './/div[contains(span,"%s")]' +
                                    '/../div/span[contains(@class,"value")]',
                                    label
                                )
                            ).join('|'),
                            elem,
                            context,
                        ),
                        ''
                    )
                )
            );
        } catch (ex) {
          console.warn('could not get order date for ' + this.id);
        }
        if (!date_filter(this.date)) {
          throw_order_discarded_error(this.id);
        }

        // This field is no longer always available, particularly for .com
        // We replace it (where we know the search pattern for the country)
        // with information from the order detail page.
        this.total = getField('.//div[contains(span,"Total")]' +
            '/../div/span[contains(@class,"value")]', elem, context);
        console.log('total direct:', this.total);

        this.who = getField('.//div[contains(@class,"recipient")]' +
            '//span[@class="trigger-text"]', elem, context);

        this.site = function(o: OrderImpl) {
            if (o.list_url) {
                const list_url_match = o.list_url.match(
                    RegExp('.*\/\/([^/]*)'));
                if (list_url_match) {
                    return util.defaulted(list_url_match[1], '');
                }
            }
            return '';
        }(this);

        if (!this.id) {
            const id_node: Node = util.findSingleNodeValue(
                '//a[contains(@class, "a-button-text") and contains(@href, "orderID=")]/text()[normalize-space(.)="Order details"]/parent::*',
                elem,
                context,
            );
            const id_elem: HTMLElement = <HTMLElement>id_node;
            const more_than_id: string|null = id_elem.getAttribute('href');
            if (more_than_id) {
                const match = more_than_id.match(/.*orderID=([^?]*)/);
                if (match && match.length > 1) {
                    this.id = match[1];
                }
            }
        }

        if (this.id && this.site) {
            this.detail_url = urls.orderDetailUrlFromListElement(
                elem, this.id, this.site
            );
            this.payments_url = urls.getOrderPaymentUrl(this.id, this.site);
        }
        this.detail_promise = extractDetailPromise(this, scheduler);
        this.payments_promise = new Promise<string[]>(
            (
                (
                    resolve: (payments: string[]) => void,
                    reject: (msg: string) => void
                ) => {
                    if (this.id?.startsWith('D')) {
                        const date = this.date ?
                            util.dateToDateIsoString(this.date) :
                            '';
                        resolve([
                            this.total ?
                                date + ': ' + this.total :
                                date
                        ]);
                    } else {
                        const event_converter = function(evt: any) {
                            const doc = util.parseStringToDOM( evt.target.responseText );
                            const payments = extraction.payments_from_invoice(doc);
                            // ["American Express ending in 1234: 12 May 2019: £83.58", ...]
                            return payments;
                        }.bind(this);
                        if (this.payments_url) {
                            scheduler.scheduleToPromise<string[]>(
                                this.payments_url,
                                event_converter,
                                util.defaulted(this.id, '9999'), // priority
                                false  // nocache
                            ).then(
                                (response: {result: string[]}) => {
                                  resolve(response.result)
                                },
                                (url: string) => {
                                  const msg = 'timeout or other error while fetching ' + url + ' for ' + this.id;
                                  console.error(msg);
                                  reject(msg);
                                },
                            );
                        } else {
                            reject('cannot fetch payments without payments_url');
                        }
                    }
                }
            ).bind(this)
        );
    }

}

interface IOrdersPageData {
    expected_order_count: number;
    order_elems: dom2json.IJsonObject;
};

async function getOrdersForYearAndQueryTemplate(
    year: number,
    query_template: string,
    scheduler: request_scheduler.IRequestScheduler,
    nocache_top_level: boolean,
    date_filter: DateFilter,
): Promise<Promise<IOrder>[]> {
    const generateQueryString = function(startOrderPos: number) {
        return sprintf.sprintf(
            query_template,
            {
                site: urls.getSite(),
                year: year,
                startOrderPos: startOrderPos
            }
        );
    };

    const convertOrdersPage = function(evt: any): IOrdersPageData {
        const d = util.parseStringToDOM(evt.target.responseText);
        const context = 'Converting orders page';
        const countSpan = util.findSingleNodeValue(
            './/span[@class="num-orders"]', d.documentElement, context);
        if ( !countSpan ) {
            const msg = 'Error: cannot find order count elem in: ' + evt.target.responseText
            console.error(msg);
            throw(msg);
        }
        const textContent = countSpan.textContent;
        const splits = textContent!.split(' ');
        if (splits.length == 0) {
            const msg = 'Error: not enough parts';
            console.error(msg);
            throw(msg);
        }
        const expected_order_count: number = parseInt( splits[0], 10 );
        console.log(
            'Found ' + expected_order_count + ' orders for ' + year
        );
        if(isNaN(expected_order_count)) {
            console.warn(
                'Error: cannot find order count in ' + countSpan.textContent
            );
        }
        let ordersElem;
        try {
            ordersElem = d.getElementById('ordersContainer');
        } catch(err) {
            const msg = 'Error: maybe you\'re not logged into ' +
                        'https://' + urls.getSite() + '/gp/css/order-history ' +
                        err;
            console.warn(msg)
            throw msg;
        }
        const order_elems: HTMLElement[] = util.findMultipleNodeValues(
            './/*[contains(concat(" ", normalize-space(@class), " "), " order ")]',
            ordersElem
        ).map( node => <HTMLElement>node );
        const serialized_order_elems = order_elems.map(
            elem => dom2json.toJSON(elem, getCachedAttributeNames())
        );
        if ( !serialized_order_elems.length ) {
            console.error(
                'no order elements in converted order list page: ' +
                evt.target.responseURL
            );
        }
        const converted = {
            expected_order_count: expected_order_count,
            order_elems: order_elems.map( elem => dom2json.toJSON(elem) ),
        }
        return converted;
    };


    const expected_order_count = await async function() {
        const orders_page_data = await scheduler.scheduleToPromise<IOrdersPageData>(
            generateQueryString(0),
            convertOrdersPage,
            '00000',
            nocache_top_level
        );
        return orders_page_data.result.expected_order_count;
    }();

    const translateOrdersPageData = function(
        response: request_scheduler.IResponse<IOrdersPageData>,
        date_filter: DateFilter,
    ): Promise<IOrder>[] {
        const orders_page_data = response.result;
        const order_elems = orders_page_data.order_elems.map(
            (elem: any) => dom2json.toDOM(elem)
        );
        function makeOrderPromise(elem: HTMLElement): Promise<IOrder>|null {
            const order = create(elem, scheduler, response.query, date_filter);
            if (typeof(order) === 'undefined') {
              return null;
            } else {
              return Promise.resolve(order!);
            }
        }
        const promises = order_elems
          .map(makeOrderPromise)
          .filter((p: Promise<IOrder>|null) => typeof(p) !== 'undefined');
        return promises;
    };

    const getOrderPromises = function(
      expected_order_count: number,
    ): Promise<Promise<IOrder>[]> {
        const page_done_promises: Promise<null>[] = [];
        const order_promises: Promise<IOrder>[] = [];
        for(let iorder = 0; iorder < expected_order_count; iorder += 10) {
            console.log(
                'sending request for order: ' + iorder + ' onwards'
            );
            page_done_promises.push(
                scheduler.scheduleToPromise<IOrdersPageData>(
                    generateQueryString(iorder),
                    convertOrdersPage,
                    '2',
                    false
                ).then(
                    page_data => {
                        const promises = translateOrdersPageData(
                          page_data, date_filter);
                        order_promises.push(...promises);
                    },
                    msg => {
                        console.error(msg);
                        return null;
                    }
                ).then(
                    () => null,
                    msg => {
                        console.error(msg);
                        return null;
                    }
                )
            );
        }
        console.log('finished sending order list page requests');
        return Promise.all(page_done_promises).then(
            () => {
                console.log('returning all order promises');
                return order_promises;
            }
       );
    }

    return getOrderPromises(expected_order_count);
}

const TEMPLATES_BY_SITE: Record<string, string[]> = {
    'www.amazon.co.jp': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s'],
    'www.amazon.co.uk': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s'],
   'www.amazon.com.au': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s'],
    'www.amazon.de': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_GB'],
    'www.amazon.es': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_GB'],
    'www.amazon.in': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_GB'],
    'www.amazon.it': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_GB'],
    'www.amazon.ca': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s'],
    'www.amazon.fr': ['https://%(site)s/gp/css/order-history' +
        '?opt=ab&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&returnTo=' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s'],
    'www.amazon.com': [
        'https://%(site)s/gp/css/order-history' +
        '?opt=ab' +
        '&ie=UTF8' +
        '&digitalOrders=1' +
        '&unifiedOrders=0' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_US',

        'https://%(site)s/gp/css/order-history' +
        '?opt=ab' +
        '&ie=UTF8' +
        '&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_US'],
    'www.amazon.com.mx': [
        'https://%(site)s/gp/your-account/order-history/ref=oh_aui_menu_date' +
        '?ie=UTF8' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s',

        'https://%(site)s/gp/your-account/order-history/ref=oh_aui_menu_yo_new_digital' +
        '?ie=UTF8' +
        '&digitalOrders=1' +
        '&orderFilter=year-%(year)s' +
        '&unifiedOrders=0' +
        '&startIndex=%(startOrderPos)s'],
    'other': [
        'https://%(site)s/gp/css/order-history' +
        '?opt=ab' +
        '&ie=UTF8' +
        '&digitalOrders=1' +
        '&unifiedOrders=0' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_GB',

        'https://%(site)s/gp/css/order-history' +
        '?opt=ab' +
        '&ie=UTF8' +
        '&digitalOrders=1' +
        '&unifiedOrders=1' +
        '&orderFilter=year-%(year)s' +
        '&startIndex=%(startOrderPos)s' +
        '&language=en_GB'],
}

function fetchYear(
    year: number,
    scheduler: request_scheduler.IRequestScheduler,
    nocache_top_level: boolean,
    date_filter: DateFilter,
): Promise<Promise<IOrder>[]> {
    let templates = TEMPLATES_BY_SITE[urls.getSite()];
    if ( !templates ) {
        templates = TEMPLATES_BY_SITE['other'];
        notice.showNotificationBar(
            'Your site is not fully supported.\n' +
            'For better support, click on the popup where it says\n' +
            '"CLICK HERE if you get incorrect results!",\n' +
            'provide diagnostic information, and help me help you.',
            document
        );
    }

    const promises_to_promises: Promise<Promise<IOrder>[]>[] = templates.map(
        template => template + '&disableCsd=no-js'
    ).map(
        template => getOrdersForYearAndQueryTemplate(
            year,
            template,
            scheduler,
            nocache_top_level,
            date_filter,
        )
    );

    return Promise.all( promises_to_promises )
    .then( array2_of_promise => {
        // We can now know how many orders there are, although we may only
        // have a promise to each order not the order itself.
        const order_promises: Promise<IOrder>[] = [];
        array2_of_promise.forEach( promises => {
            promises.forEach( (promise: Promise<IOrder>) => {
                order_promises.push(promise);
            });
        });
        return order_promises;
    });
}

export function getOrdersByYear(
    years: number[],
    scheduler: request_scheduler.IRequestScheduler,
    latest_year: number,
    date_filter: DateFilter,
): Promise<Promise<IOrder>[]> {
    // At return time we may not know how many orders there are, only
    // how many years in which orders have been queried for.
    return Promise.all(
        years.map(
            function(year: number): Promise<Promise<IOrder>[]> {
                const nocache_top_level = (year == latest_year);
                return fetchYear(
                  year, scheduler, nocache_top_level, date_filter);
            }
        )
    ).then(
        (a2_of_o_promise: Promise<IOrder>[][]) => {
            // Flatten the array of arrays of Promise<Order> into
            // an array of Promise<Order>.
            const order_promises: Promise<IOrder>[] = [];
            a2_of_o_promise.forEach(
                (year_order_promises: Promise<IOrder>[]) => {
                    year_order_promises.forEach(
                        (order_promise: Promise<IOrder>) => {
                            order_promises.push(order_promise);
                        }
                    );
                }
            );
            return order_promises;
        }
    );
}

export async function getOrdersByRange(
  start_date: Date,
  end_date: Date,
  scheduler: request_scheduler.IRequestScheduler,
  latest_year: number,
  date_filter: DateFilter,
): Promise<Promise<IOrder>[]> {
  console.assert(start_date < end_date);
  const start_year = start_date.getFullYear();
  const end_year = end_date.getFullYear();

  let years: number[] = []
  for (let y=start_year; y<=end_year; y++) {
    years.push(y);
  }

  const order_years = years.map(
      year => {
        const nocache_top_level = latest_year == year;
        return fetchYear(year, scheduler, nocache_top_level, date_filter)
      }
  );

  const unflattened = await util.get_settled_and_discard_rejects(order_years);
  const flattened_promises: Promise<IOrder>[] = unflattened.flat();
  const settled: IOrder[] = await util.get_settled_and_discard_rejects(flattened_promises);

  const f_in_date_window = async function(order: IOrder): Promise<boolean> {
    const order_date = await order.date();
    if (order_date) {
      return start_date <= order_date && order_date <= end_date;
    } else {
      return false;
    }
  }

  const filtered_orders: IOrder[] = await util.filter_by_async_predicate(
    settled,
    f_in_date_window,
  );

  // Wrap each order in a promise to match getOrdersByYear return signature.
  return filtered_orders.map(o => Promise.resolve(o));
}

function throw_order_discarded_error(order_id: string|null): void {
  const ode = new Error('OrderDiscardedError:' + order_id);
  throw ode;
}

export async function get_legacy_items(order: IOrder): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const item_list: item.IItem[] = await order.item_list();
  item_list.forEach(item => {
    result[item.description] = item.url;
  });
  return result;
};

export async function assembleDiagnostics(order: IOrder): Promise<Record<string,any>> {
    const diagnostics: Record<string, any> = {};
    const field_names: (keyof IOrder)[] = [
        'id',
        'list_url',
        'detail_url',
        'payments_url',
        'date',
        'total',
        'who',
    ];
    field_names.forEach(
        ((field_name: keyof IOrder) => {
            const value: any = order[field_name];
            diagnostics[<string>(field_name)] = value;
        })
    );

    const sync_order: ISyncOrder = await sync(order);

    diagnostics['items'] = await get_legacy_items(order);

    return Promise.all([
        signin.checkedFetch( util.defaulted(sync_order.list_url, '') )
            .then( response => response.text())
            .then( text => { diagnostics['list_html'] = text; } ),
        signin.checkedFetch( util.defaulted(sync_order.detail_url, '') )
            .then( response => response.text() )
            .then( text => { diagnostics['detail_html'] = text; } ),
        signin.checkedFetch(util.defaulted(sync_order.payments_url, ''))
            .then( response => response.text() )
            .then( text => { diagnostics['invoice_html'] = text; } )
    ]).then(
        () => diagnostics,
        error_msg => {
            notice.showNotificationBar(error_msg, document);
            return diagnostics;
        }
    );
}

export function create(
    ordersPageElem: HTMLElement,
    scheduler: request_scheduler.IRequestScheduler,
    src_query: string,
    date_filter: DateFilter,
): IOrder|null {
    try {
      const impl = new OrderImpl(
        ordersPageElem,
        scheduler,
        src_query,
        date_filter,
      );
      const wrapper = new Order(impl);
      return wrapper;
    } catch(err) {
      console.log('order.create caught: ' + err + '; returning null')
      return null;
    }
}
