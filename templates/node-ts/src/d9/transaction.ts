import { v4 as uuid } from 'uuid';
import { D9Client } from './client.js';
import { isQuoteExpired, Quote } from './quote.js';

export type ServiceType = 'C2C' | 'B2B';

// Sender shape varies by service_type. Build via factory functions in business code.
export type Sender = Record<string, unknown>;

// Receiver shape varies by receiving_mode. Build via factory functions in business code.
export type Receiver = Record<string, unknown>;

export interface CreateTxnInput {
  quote:           Quote;
  serviceType:     ServiceType;
  sender:          Sender;
  receiver:        Receiver;
  sourceOfIncome:  string;     // e.g. "SLRY"
  purposeOfTxn:    string;     // e.g. "SUPP"
  agentRefOverride?: string;   // optional — pass to retry idempotently
}

export interface Transaction {
  transactionRefNumber:      string;
  agentTransactionRefNumber: string;
  expiresAt:                 Date;
  raw:                       unknown;
}

const PARTNER_PREFIX = '{{PARTNER_PREFIX}}';

/**
 * Create a transaction from a quote.
 *
 * Idempotency: pass `agentRefOverride` to retry an in-flight call without creating a duplicate.
 * If you don't pass it, a fresh UUID is generated. PERSIST the returned `agentTransactionRefNumber`
 * BEFORE the call in production code so you can retry on timeout.
 */
export async function createTransaction(client: D9Client, input: CreateTxnInput): Promise<Transaction> {
  if (isQuoteExpired(input.quote)) {
    throw new Error('Quote expired before createTransaction. Re-quote and ask the user to confirm the new rate.');
  }

  const agentRef = input.agentRefOverride ?? `${PARTNER_PREFIX}_${uuid()}`;

  const body = {
    quote_id:                     input.quote.quoteId,
    service_type:                 input.serviceType,
    agent_transaction_ref_number: agentRef,
    sender:                       input.sender,
    receiver:                     input.receiver,
    transaction: {
      source_of_income: input.sourceOfIncome,
      purpose_of_txn:   input.purposeOfTxn,
    },
  };

  const { data } = await client.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/createtransaction',
    data:   body,
  });

  if (data.state !== 'ACCEPTED') {
    throw new Error(`Unexpected state on createTransaction: ${data.state}/${data.sub_state}`);
  }

  return {
    transactionRefNumber:      data.data.transaction_ref_number,
    agentTransactionRefNumber: data.data.agent_transaction_ref_number,
    expiresAt:                 new Date(data.data.expires_at),
    raw:                       data,
  };
}
