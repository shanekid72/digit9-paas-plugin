import { D9Client } from './client.js';
import { isQuoteExpired, Quote } from './quote.js';

// Sender shape varies by service type (consumer C2C vs business B2B). Build via
// factory functions in business code. See the d9-transaction skill for the
// canonical Postman fields.
export type Sender = Record<string, unknown>;

// Receiver shape varies by receiving country and mode (IN BANK uses routing_code,
// PK BANK uses iban + iso_code, BD BANK uses iso_code + account_number, etc.).
// Build via factory functions in business code.
export type Receiver = Record<string, unknown>;

export interface CreateTxnInput {
  quote:          Quote;
  sender:         Sender;
  receiver:       Receiver;
  sourceOfIncome: string;       // e.g. "SLRY", "BUSN", "INVM"
  purposeOfTxn:   string;       // e.g. "SUPP", "EDUC", "SAVG"
  message?:       string;       // free-text; defaults to "Agency transaction"
}

export interface Transaction {
  transactionRefNumber: string;  // 16-char system-generated id; persist this
  expiresAt:            Date;
  raw:                  unknown;
}

/**
 * Create a transaction from a quote.
 *
 * Idempotency is keyed off sender.agent_customer_number plus quote_id. Calling
 * with the same agent_customer_number against the same quote_id returns the
 * existing transaction — safe to retry on network timeout with the same body.
 *
 * Body shape per the canonical PAASTestAgent Postman collection: type,
 * instrument, source_of_income, purpose_of_txn, message live at top level;
 * `transaction` only carries `quote_id`. There is no top-level `service_type`
 * or `agent_transaction_ref_number` in the canonical happy-path body.
 */
export async function createTransaction(client: D9Client, input: CreateTxnInput): Promise<Transaction> {
  if (isQuoteExpired(input.quote)) {
    throw new Error('Quote expired before createTransaction. Re-quote and ask the user to confirm the new rate.');
  }

  const body = {
    type:             'SEND',
    instrument:       'REMITTANCE',
    source_of_income: input.sourceOfIncome,
    purpose_of_txn:   input.purposeOfTxn,
    message:          input.message ?? 'Agency transaction',
    sender:           input.sender,
    receiver:         input.receiver,
    transaction:      { quote_id: input.quote.quoteId },
  };

  const { data } = await client.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/createtransaction',
    data:   body,
  });

  if (data.data?.state !== 'ACCEPTED') {
    throw new Error(`Unexpected state on createTransaction: ${data.data?.state}/${data.data?.sub_state}`);
  }

  return {
    transactionRefNumber: data.data.transaction_ref_number,
    expiresAt:            new Date(data.data.expires_at),
    raw:                  data,
  };
}
