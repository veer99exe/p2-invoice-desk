using { p2 } from '../db/schema';

@path: '/invoices'
@requires: ['APClerk', 'APManager']
service InvoiceService {

  // Read-only: every change goes through the actions, which enforce R1-R3.
  @readonly
  entity Invoices as projection on p2.Invoices actions {
    action decide(decision : p2.DecisionType, rootCause : p2.RootCauseType, note : String) returns Invoices;
    action draftExplanation()          returns String;     // AI draft: returned, never stored
    action confirmNote(text : String)  returns Invoices;   // "Use and save": note + aiAssisted = true
  };

  @readonly
  entity Decisions as projection on p2.Decisions;
}
