using InvoiceService as service from '../srv/invoice-service';

// Screens. Project Accelerator generates the app/ folder; these annotations replace/extend its
// annotations.cds (see README). List Report = work list sorted by priority; Object Page = 3 tabs.
annotate service.Invoices with @(
  UI.HeaderInfo: {
    TypeName: 'Supplier Invoice', TypeNamePlural: 'Supplier Invoices',
    Title: { Value: SupplierInvoice }, Description: { Value: InvoicingParty }
  },
  UI.SelectionFields: [ priorityLevel, CompanyCode, InvoicingParty, DocumentCurrency,
                        DuplicateSuspected, Overdue, AboveThreshold, BlockedInS4, Decision ],
  UI.PresentationVariant: {
    SortOrder: [ { Property: priorityScore, Descending: true }, { Property: DueDate } ],
    Visualizations: [ '@UI.LineItem' ]
  },
  UI.LineItem: [
    { Value: priorityLevel, Criticality: priorityCriticality },
    { Value: SupplierInvoice }, { Value: InvoicingParty },
    { Value: InvoiceGrossAmount }, { Value: DocumentCurrency }, { Value: DueDate },
    { Value: DuplicateSuspected }, { Value: Overdue }, { Value: AboveThreshold }, { Value: BlockedInS4 },
    { Value: Decision }, { Value: priorityReasons }, { Value: Source }
  ],
  UI.Facets: [
    { $Type: 'UI.CollectionFacet', ID: 'InvoiceData', Label: 'Invoice Data', Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'Invoice Header',   Target: '@UI.FieldGroup#Header' },
      { $Type: 'UI.ReferenceFacet', Label: 'Dates and Terms',  Target: '@UI.FieldGroup#Dates' },
      { $Type: 'UI.ReferenceFacet', Label: 'Amount and Block', Target: '@UI.FieldGroup#Amount' } ] },
    { $Type: 'UI.CollectionFacet', ID: 'Checks', Label: 'Checks', Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'Check Results', Target: '@UI.FieldGroup#Checks' },
      { $Type: 'UI.ReferenceFacet', Label: 'Priority',      Target: '@UI.FieldGroup#Priority' } ] },
    { $Type: 'UI.CollectionFacet', ID: 'DecisionTab', Label: 'Decision', Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'Decision', Target: '@UI.FieldGroup#Decision' },
      { $Type: 'UI.ReferenceFacet', Label: 'Audit',    Target: '@UI.FieldGroup#Audit' } ] }
  ],
  UI.FieldGroup #Header:   { Data: [ { Value: SupplierInvoice }, { Value: FiscalYear }, { Value: CompanyCode },
                                     { Value: InvoicingParty }, { Value: Source }, { Value: DocumentHeaderText } ] },
  UI.FieldGroup #Dates:    { Data: [ { Value: DocumentDate }, { Value: PostingDate },
                                     { Value: DueCalculationBaseDate }, { Value: NetPaymentDays } ] },
  UI.FieldGroup #Amount:   { Data: [ { Value: InvoiceGrossAmount }, { Value: DocumentCurrency }, { Value: PaymentBlockingReason } ] },
  UI.FieldGroup #Checks:   { Data: [ { Value: DuplicateSuspected }, { Value: Overdue }, { Value: AboveThreshold },
                                     { Value: BlockedInS4 }, { Value: CheckedAsOf } ] },
  UI.FieldGroup #Priority: { Data: [ { Value: priorityLevel, Criticality: priorityCriticality }, { Value: priorityScore },
                                     { Value: priorityReasons } ] },
  UI.FieldGroup #Decision: { Data: [ { Value: Decision }, { Value: RootCause }, { Value: Note }, { Value: AIAssisted } ] },
  UI.FieldGroup #Audit:    { Data: [ { Value: DecidedBy }, { Value: DecidedAt } ] },
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.decide',           Label: 'Record decision' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.draftExplanation', Label: 'AI draft' },
    { $Type: 'UI.DataFieldForAction', Action: 'InvoiceService.confirmNote',      Label: 'Use and save note' }
  ]
);

annotate service.Invoices with {
  priorityReasons    @UI.MultiLineText;
  DocumentHeaderText @UI.MultiLineText;
  Note               @UI.MultiLineText;
  DuplicateSuspected @title: 'Duplicate suspected';
  Overdue            @title: 'Overdue / due soon';
  AboveThreshold     @title: 'Above threshold';
  BlockedInS4        @title: 'Blocked in S/4';
  priorityLevel      @title: 'Priority';
  priorityScore      @title: 'Score';
  priorityReasons    @title: 'Why';
  AIAssisted         @title: 'AI-assisted note';
  CheckedAsOf        @title: 'Checked as of';
};

annotate service.Decisions with @(
  UI.HeaderInfo: { TypeName: 'Decision', TypeNamePlural: 'Decisions', Title: { Value: SupplierInvoice } },
  UI.LineItem: [ { Value: SupplierInvoice }, { Value: FiscalYear }, { Value: Source }, { Value: Decision },
                 { Value: RootCause }, { Value: Note }, { Value: AIAssisted }, { Value: DecidedBy }, { Value: DecidedAt } ]
);
