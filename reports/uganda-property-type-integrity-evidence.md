# Uganda property-type integrity evidence — staging candidate

Marker: `uganda-master-intake-recovery-20260811`

## Defect confirmed

The integrity check previously classified only immutable source text, while the King form showed an editable `property_type`. When no physical type token appeared in the source, issue `category_ambiguous` included `proposed_listing_type`, and the client rendered that as `Proposed category: rent`. The category was not the missing fact; the physical property type was.

## Corrected semantics

- Intake and automated publication still evaluate source evidence and stay hard-gated.
- The source evidence set now includes stored source title/caption/description/OCR fields rather than accidentally stopping at a generated title.
- A property type saved in the same authenticated `super_admin` or `moderator` status action is recorded as human verified and can satisfy the physical-type check for that human session.
- API keys and automated sessions cannot activate this trust path.
- A genuinely type-less source remains `category_ambiguous` by default.

## Corrected issue payload shape

```json
{
  "code": "category_ambiguous",
  "issue_subject": "property_type",
  "message": "Source evidence does not confirm a specific physical property type. Form value: Apartment.",
  "form_property_type": "Apartment",
  "source_evidence": "Beautiful place for rent Call for viewing"
}
```

`proposed_listing_type` is deliberately absent for this physical-type failure, so King no longer labels the warning as a proposed category.

## Shared recognized vocabulary

The recognizer and recovery classifier import `utils/propertyTypeVocabulary.js`. It covers land/plot/acre/decimal/kibanja; shop/office/arcade/warehouse; apartment/condo/flat; house/bungalow/mansion/duplex/villa; student hostel signals; and Uganda room language including double room, single room, muzigo, self-contained, bedsitter and studio room.

Regression fixtures prove double room, single room, muzigo and self-contained rent evidence pass; a genuinely type-less row remains blocked; the trusted human edit is accepted only when the caller explicitly supplies the human-review option.
