/* Copyright(c) 2018-2023 Philip Mulcahy. */

'use strict';

import * as cachestuff from './cachestuff';
import * as util from './util';
import * as extpay from './extpay_client';
import * as msg from './message_types';
import * as settings from './settings';
import * as urls from './url';

export const ALLOWED_EXTENSION_IDS: (string | undefined)[] = [
  'apgfmdalhahnnfgmjejmhkeobobobhjd', // azad_test dev Philip@ball.local
  'ofddmcjihdeahnjehbpaaopghkkncndh', // azad_test dev Ricardo's
  'hldaogmccopioopclfmolfpcacadelco', // EZP_Ext Dev Ricardo
  'jjegocddaijoaiooabldmkcmlfdahkoe', // EZP Regular Release
  'ccffmpedppmmccbelbkmembkkggbmnce', // EZP Early testers Release
  'ciklnhigjmbmehniheaolibcchfmabfp', // EZP Alpha Tester Release
];

const content_ports: Record<string, chrome.runtime.Port> = {};
let control_port: msg.ControlPort | null = null;
let advertised_periods: number[] = [];
let iframeWorkerTaskSpec: any = {}; 

function broadcast_to_content_pages(msg: any): void {
  Object.values(content_ports).forEach(
    (port) => {
      try {
        port.postMessage(msg);
      } catch (ex) {
        console.warn('error when sending msg to content port', ex);
      }
    }
  );
}
export async function sendToOneContentPage(msg: any) {
  async function getBestContentPort(): Promise<chrome.runtime.Port|null> {

    const [activeTab] = await chrome.tabs.query({
      active: true, lastFocusedWindow: true
    });

    // sorted for consistency
    const keys = Object.keys(content_ports)
      .filter(k => k.startsWith('azad_inject:'))
      .sort((a,b) => {
        if (a>b) { return 1; }
        else if (b>a) { return -1; }
        else { return 0; }
      });

    console.log('getBestContentPort() keys:', keys);

    const ports = keys.map(k => content_ports[k]);

    for (const port of ports) {
      const sender: chrome.runtime.MessageSender = port.sender!;
      const tab: chrome.tabs.Tab = sender.tab!;
      try {
        if (activeTab && tab.id == activeTab.id ) {
          return port;
        }
      } catch (ex) {
        console.warn(ex);
      }
    }

    return ports.at(0) ?? null;
  }

  const target = await getBestContentPort();

  if (target) {
    try {
      target.postMessage(msg);
    } catch (ex) {
      console.warn(
        'sendToOneContentPage caught', ex, 'when trying to post msg');
    }
  } else {
    console.log('no appropriate content page message port found');
  }
}

function registerConnectionListener() {
  chrome.runtime.onConnect.addListener((port) => {
    console.log('new connection from ' + port.name);
    const portNamePrefix = port.name.split(':')[0];

    function getContentPortKey(port: chrome.runtime.Port): string {
      const name = port?.name;
      const tabId = port?.sender?.tab?.id?.toString() ?? '?';
      const url = port?.sender?.url ?? '?';
      const key = `${name}#${tabId}#${url}`;
      return key;
    }

    switch (portNamePrefix) {
      case 'azad_inject':
      case 'azad_iframe_worker':
        {
          const portKey = getContentPortKey(port);
          console.log('adding content port', portKey);
          content_ports[portKey] = port;

          port.onDisconnect.addListener(() => {
            const key = getContentPortKey(port);

            if (key != null && typeof(key) != 'undefined') {
              console.log('removing disconnected port', key);
              delete content_ports[key];
            }
          });

          port.onMessage.addListener((msg) => {
            switch (msg.action) {
              case 'advertise_periods':
                console.log('forwarding advertise_periods', msg.period);
                advertised_periods = [
                  ...Array.from(
                    new Set<number>(msg.periods)
                  ),
                ].sort((a, b) => a - b);
                advertisePeriods();
                break;
              case 'statistics_update':
                if (control_port) {
                  try {
                    control_port?.postMessage(msg);
                  } catch (ex) {
                    console.debug(
                      'cannot post stats msg to non-existent control port');
                  }
                }
                break;
              case 'get_iframe_task_instructions':
                port.postMessage(iframeWorkerTaskSpec);
                break;
              case 'transactions':
                console.log('forwarding transactions');
                broadcast_to_content_pages({action: 'remove_iframe_worker'});
                sendToOneContentPage(msg);
                break;
              default:
                console.debug('unknown action: ' + msg.action);
                break;
            }
          });
        }

        break;
      case 'azad_control':
        control_port = port;

        port.onMessage.addListener(async (msg) => {
          switch (msg.action) {
            case 'scrape_years':
            case 'scrape_range':
              await async function(){
                const table_type = await settings.getString('azad_table_type');
                if (table_type == 'transactions') {
                  msg.action = 'scrape_transactions';

                  // No site prefix: background page doesn't know!
                  const url = '/cpe/yourpayments/transactions';

                  iframeWorkerTaskSpec = msg;
                  sendToOneContentPage({action: 'start_iframe_worker', url, });
                } else {
                  console.debug('forwarding:', msg);
                  sendToOneContentPage(msg);
                }
              }();
              break;
            case 'check_feature_authorized':
              handleAuthorisationRequest(msg.feature_id, control_port);
              break;
            case 'show_payment_ui':
              console.log('got show_payment_ui request');
              extpay.display_payment_ui();
              break;
            case 'show_extpay_login_ui':
              console.log('got show_extpay_login_ui request');
              extpay.display_login_page();
              break;
            case 'clear_cache':
              broadcast_to_content_pages(msg);
              break;
            case 'force_logout':
              broadcast_to_content_pages(msg);
              break;
            case 'abort':
              broadcast_to_content_pages(msg);
              break;
            default:
              console.warn('unknown action: ' + msg.action);
              break;
          }
        });

        advertisePeriods();
        break;

      default:
        console.warn('unknown port name: ' + port.name);
    }
  });
}

function registerExternalConnectionListener() {
  chrome.runtime.onMessageExternal.addListener( function (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) {
    console.log(
      `Received Ext Msg: (Prior to Whitelist Filter) From:${sender.id} Msg:`,
      message
    );

    if (!ALLOWED_EXTENSION_IDS.includes(sender.id)) {
      console.log(
        `  Message Ignored: Sender (${sender.id}) is not Whitlisted..`,
        message
      );
      return; // don't allow access
    }

    if (message.action == 'get_items_3m') {
      const month_count = 3;
      const end_date = new Date();
      const start_date = util.subtract_months(end_date, month_count);
      console.log('sending scrape_range', start_date, end_date);
      const msg = {
        action: 'scrape_range_and_dump_items',
        start_date: start_date,
        end_date: end_date,
        sender_id: sender.id,
      };
      sendToOneContentPage(msg);
      sendResponse({ status: 'ack' });
    } else {
      sendResponse({ status: 'unsupported' });
    }

    // Incompletely documented, but returning true seems to be needed to allow
    // sendResponse calls to succeed.
    return true;
  });
}

function registerRightClickActions() {
  chrome.contextMenus.remove('save_order_debug_info', () => {
    chrome.contextMenus.create({
      id: 'save_order_debug_info',
      title: 'save order debug info',
      contexts: ['link'],
    });
  });
  chrome.contextMenus.onClicked.addListener((info) => {
    console.log('context menu item: ' + info.menuItemId + ' clicked;');
    if (info.menuItemId == 'save_order_debug_info') {
      if (/orderID=/.test(info.linkUrl!)) {
        const match = info?.linkUrl?.match(/.*orderID=([0-9A-Z-]*)$/);
        const order_id = match![1];
        if (match) {
          broadcast_to_content_pages({
            action: 'dump_order_detail',
            order_id: order_id,
          });
        }
      } else if (/search=/.test(info.linkUrl!)) {
        const match = info?.linkUrl?.match(/.*search=([0-9A-Z-]*)$/);
        const order_id = match![1];
        if (match) {
          broadcast_to_content_pages({
            action: 'dump_order_detail',
            order_id: order_id,
          });
        }
      }
    }
  });
}

function registerMessageListener() {
  chrome.runtime.onMessage.addListener((request, sender) => {
    console.log(
      sender.tab
        ? 'from a content script:' + sender.tab.url
        : 'from the extension'
    );
    switch (request.action) {
      case 'remove_cookie':
        chrome.cookies.remove(
          {
            url: request.cookie_url,
            name: request.cookie_name,
          },
          () => console.log(
            'removed cookie ' + request.cookie_url + ' ' + request.cookie_name
          )
        );
        break;
      case 'open_tab':
        console.log('opening: ' + request.url);
        chrome.tabs.create({ url: request.url });
        break;
      default:
        console.trace('ignoring action: ' + request.action);
    }
  });
}

function advertisePeriods() {
  if (control_port) {
    console.log('advertising periods', advertised_periods);
    try {
      control_port.postMessage({
        action: 'advertise_periods',
        periods: advertised_periods,
      });
    } catch (ex) {
      console.warn(
        'background.advertisePeriods caught: ', ex,
        ', perhaps caused by trying to post to a disconnected control_port?');
    }
  } else {
    console.log('Cannot advertise periods yet: no control port is set.');
  }
}

async function handleAuthorisationRequest(
  feature_id: string,
  control_port: msg.ControlPort | null
): Promise<void> {
  const ext_pay_authorised = await extpay.check_authorised();
  const authorised = feature_id == 'premium_preview' ?
    ext_pay_authorised :
    false;
  settings.storeBoolean('preview_features_enabled', authorised);
  try {
    control_port?.postMessage({
      action: 'authorisation_status',
      authorisation_status: authorised,
    });
  } catch(ex) {
    const e = ex!.toString();
    if (!(e as string).includes('disconnected')) {
      throw ex;
    }
  }
}

function registerVersionUpdateListener() {
  chrome.runtime.onInstalled.addListener(() => {
    console.log(
      'Chrome has told me that either a new version of this extension or a' +
        ' new version of Chrome has been installed. This might make existing' +
        " AZAD cache entries incompatible with the new version: let's clear" +
        ' them out.'
    );
    // The (big) problem with this implementation is that the cache is in the
    // Amazon sites' cache areas, which means we can only get to them when
    // we've got an injected tab open. I think this problem means we need to
    // get going on https://github.com/philipmulcahy/azad/issues/231
    // until that's fixed, users will sometimes need to manually clear their
    // caches.
    broadcast_to_content_pages({ action: 'clear_cache' });
  });
}

cachestuff.registerCacheListenerInBackgroundPage();
registerVersionUpdateListener();
registerConnectionListener();
registerRightClickActions();
registerMessageListener();
registerExternalConnectionListener();
