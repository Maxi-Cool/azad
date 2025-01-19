import * as extraction from './extraction';
const lzjs = require('lzjs');
import * as transaction from './transaction';
import * as util from './util';

const CACHE_KEY = 'ALL_TRANSACTIONS';

export async function reallyScrapeAndPublish(
  getPort: () => Promise<chrome.runtime.Port | null>
) {
  const transactions = await extractTransactions();
  const port = await getPort();
  try {
    if (port) {
      port.postMessage({
        action: 'transactions',
        transactions,
      });
    }
  } catch (ex) {
    console.warn(ex);
  }
}

function extractPageOfTransactions(): transaction.Transaction[] {
  const dateElems: Element[] = extraction.findMultipleNodeValues(
    '//div[contains(@class, "transaction-date-container")]',
    document.documentElement,
    'transaction date extraction',
  ) as Element[];

  return dateElems.map(de => extractTransactionsWithDate(de)).flat();
}

function extractTransactionsWithDate(
  dateElem: Element
): transaction.Transaction[] {
  const dateString = util.defaulted(dateElem.textContent, '1970-01-01');
  const date = new Date(dateString);
  const transactionElemContainer = dateElem.nextElementSibling;

  const transactionElems: HTMLElement[] = extraction.findMultipleNodeValues(
    './/div[contains(@class, "transactions-line-item")]',
    transactionElemContainer as HTMLElement,
    'finding transaction elements') as HTMLElement[];

  return transactionElems
    .map(te => extractSingleTransaction(date, te))
    .filter(t => t) as transaction.Transaction[];
}

function extractSingleTransaction(
  date: Date,
  elem: Element,
): transaction.Transaction | null {
  const children = extraction.findMultipleNodeValues(
    './div',
    elem as HTMLElement,
    'transaction components') as HTMLElement[];

  const cardAndAmount = children[0];

  const orderIdElems = children
    .slice(1)
    .filter(oie => oie.textContent?.match(util.orderIdRegExp()));

  const vendorElems = children
    .slice(1)
    .filter(oie => !oie.textContent?.match(util.orderIdRegExp()));

  const vendor = vendorElems.length
    ? (vendorElems.at(-1)?.textContent?.trim() ?? '??')
    : '??';

  const orderIds: string[] = orderIdElems.map(
    oe => util.defaulted(
      extraction.by_regex(
        ['.//a[contains(@href, "order")]'],
        new RegExp('.*([A-Z0-9]{3}-\\d+-\\d+).*'),
        '??',
        oe,
        'transaction order id',
      ),
      '??',
    )
  );

  const amountSpan = extraction.findMultipleNodeValues(
    './/span',
    cardAndAmount,
    'amount span'
  )[1] as HTMLElement;

  const amountText = amountSpan.textContent ?? '0';
  const amountMatch = amountText.match(util.moneyRegEx());
  const amount: number = amountMatch ? +amountMatch[3] : 0;

  const cardInfo = util.defaulted(
    extraction.by_regex(
      ['.//span'],
      new RegExp('(.*\\*{4}.*)'),
      '??',
      cardAndAmount,
      'transaction amount',
    ),
    '??',
  );

  const transaction = {
    date,
    orderIds,
    cardInfo,
    amount,
    vendor,
  };

  console.debug(transaction);

  return transaction;
}

function mergeTransactions(
  a: transaction.Transaction[],
  b: transaction.Transaction[]
): transaction.Transaction[] {
  // Q: Why are you not using map on Set.values() iterator?
  // A? YCM linting thinks it's not a thing, along with a bunch of other
  //    sensible iterator magic. Chrome is fine with it, but my life is too
  //    short, and in the typical use case the copy won't be too expensive.
  const merged = new Set<string>([a, b].flat().map(t => JSON.stringify(t)));
  const ss = Array.from(merged.values());

  const ts: transaction.Transaction[] = restoreDateObjects(
    ss.map(s => JSON.parse(s)));

  return ts;
}

async function extractTransactions() {
  const cached = await getTransactionsFromCache();
  const maxCachedTimestamp = Math.max(...cached.map(t => t.date.getTime()));
  const firstPage = extractPageOfTransactions();
  let minNewTimestamp = Math.min(...firstPage.map(t => t.date.getTime()));
  let transactions = mergeTransactions(firstPage, cached);
  let nextButton = findUsableNextButton() as HTMLElement;

  while(nextButton && minNewTimestamp >= maxCachedTimestamp) {
    nextButton.click();
    await new Promise(r => setTimeout(r, 7500));

    const page = extractPageOfTransactions();
    console.log('scraped', page.length, 'transactions');
    minNewTimestamp = Math.min(...transactions.map(t => t.date.getTime()));
    transactions = mergeTransactions(page, transactions);
    nextButton = findUsableNextButton() as HTMLElement;
  }

  putTransactionsInCache(transactions);
  return transactions;
}

function findUsableNextButton(): HTMLInputElement | null {
  try {
    const buttonInputElem = extraction.findSingleNodeValue(
      '//span[contains(@class, "button")]/span[text()="Next page"]/preceding-sibling::input[not(@disabled)]',
      document.documentElement,
      'finding transaction elements'
    ) as HTMLInputElement;
    return buttonInputElem;
  } catch(_) {
    return null;
  }
}

function maybeClickNextPage(): void {
  const btn = findUsableNextButton();
  if (btn) {
    console.log('clicking next page button');
    btn.click();
  } else {
    console.log('no next page button found');
  }
}

async function getTransactionsFromCache(): Promise<transaction.Transaction[]> {
  const compressed = await transaction.getCache().get(CACHE_KEY);
  if (!compressed) {
    return [];
  }
  const s = lzjs.decompress(compressed);
  const ts = restoreDateObjects(JSON.parse(s));
  return ts;
}

function putTransactionsInCache(ts: transaction.Transaction[]) {
  const s = JSON.stringify(ts);
  const compressed = lzjs.compress(s);
  transaction.getCache().set(CACHE_KEY, compressed);
}

function restoreDateObjects(
  ts: transaction.Transaction[]
): transaction.Transaction[] {
  return ts.map( t => {
    const copy = JSON.parse(JSON.stringify(t));
    copy.date = new Date(copy.date);
    return copy;
  });
}
