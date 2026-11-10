namespace p2;

type DecisionType : String enum {
  Release;
  KeepBlocked = 'Keep Blocked';
  Escalate;
}

type RootCauseType : String enum {
  Duplicate;
  Overdue;
  AboveThreshold = 'Above Threshold';
  PaymentBlock   = 'Payment Block';
  SupplierData   = 'Supplier Data';
  Other;
}

// Refilled on every list load from the S/4 sandbox (+ seeded story invoices) and P4.
// Lives only in the in-memory database: S/4 stays the owner of invoices,
// P4 stays the owner of decisions. Nothing here is a system of record.
entity Invoices {
  key SupplierInvoice        : String(20);
  key FiscalYear             : String(4);
  key Source                 : String(5);          // 'S4' | 'STORY'
  CompanyCode                : String(4);
  InvoicingParty             : String(10);
  DocumentDate               : Date;
  PostingDate                : Date;
  DueCalculationBaseDate     : Date;
  NetPaymentDays             : Integer;
  InvoiceGrossAmount         : Decimal(15, 2);
  DocumentCurrency           : String(5);
  PaymentBlockingReason      : String(1);
  DocumentHeaderText         : String(255);
  // calculated checks (never typed in)
  DueDate                    : Date;
  CheckedAsOf                : Date;
  DuplicateSuspected         : Boolean;
  Overdue                    : Boolean;              // overdue or due within 3 days (S5)
  AboveThreshold             : Boolean;              // null = no threshold for this currency
  BlockedInS4                : Boolean;
  // priority (S6)
  priorityLevel              : String(10);
  priorityScore              : Integer;
  priorityReasons            : String(1000);
  priorityCriticality        : Integer;
  // stored decision (read from P4)
  Decision                   : DecisionType;
  RootCause                  : RootCauseType;
  Note                       : String(1000);
  AIAssisted                 : Boolean;
  DecidedBy                  : String(100);
  DecidedAt                  : Timestamp;
}

entity Decisions {
  key Source                 : String(5);
  key SupplierInvoice        : String(20);
  key FiscalYear             : String(4);
  Decision                   : DecisionType;
  RootCause                  : RootCauseType;
  Note                       : String(1000);
  AIAssisted                 : Boolean;
  DecidedBy                  : String(100);
  DecidedAt                  : Timestamp;
}
