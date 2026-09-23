-- Soften mid-tier (score >= 30) at_risk customers' deteriorating trend to stable.
-- DRY RUN: ends with ROLLBACK. Flip to COMMIT after review.
-- After applying, re-run tests/payments/backfill-payment-health.mjs.

BEGIN;

-- American Airlines Group Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='4246e69c-77f5-4c15-ab91-dfb174c135e5';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='5f138f16-5060-4735-99a5-d25f5f4d0085';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='9eb8ffd9-5242-40fc-b511-a400c16aaa57';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='4ab399ea-bde1-4d36-b796-6cf640927ac0';

-- Arconic Corporation: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='9bac1be0-aa2d-4dd6-a4a9-d399266690e5';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='e4029b5f-9e16-49ae-aabd-48b73ebb0f3a';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='0be226d3-ef32-41ce-b3bf-dab8621fb0f4';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='b1b52ccc-dcf4-48d2-b5d4-392047275955';

-- Atlas Precision Manufacturing: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='df577045-4bec-4d95-a075-7297e11d5b23';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='e788c38b-0482-45e5-b670-73219ab65643';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='81191ec2-62b5-4eaf-b679-9745d0b62ed5';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='04634ab5-4c74-4f1a-b718-77a8f6bb40bc';

-- Cascade Industrial Systems: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=52, on_time=false WHERE id='932c91f3-ad0e-48b2-9d78-129530d614eb';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=57, on_time=false WHERE id='2f51eae4-07f3-413e-b6e9-766dda9fc210';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=62, on_time=false WHERE id='db5f23f6-6d04-41fc-a5d5-2d259d18d2c5';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=68, on_time=false WHERE id='0b992b7e-4ebf-4298-9355-5dd4ec0b700f';

-- Coeur Mining Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='f1877309-09a0-49cc-8e8b-6a95320c6f29';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='f53f33b9-db16-4677-97a1-569fa89befc0';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='b795020e-fbcb-403e-affb-891b17f7608c';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='7ef3a42d-ba9a-4f8e-9f30-fc6e027d73fd';

-- General Electric Company (Power segment): delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=82, on_time=false WHERE id='7e6519bd-4d2e-409d-b58b-6bf93602dee8';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=87, on_time=false WHERE id='e7086061-0124-4e74-9771-f571970ff445';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=92, on_time=false WHERE id='0372ce17-4928-4890-ac97-bffac851a547';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=98, on_time=false WHERE id='1066bb03-9c2a-44c4-ad4a-6f0d0dc2c195';

-- Ironwood Machine Works: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=52, on_time=false WHERE id='3157a027-cf2b-4d5e-8cef-3745d9d8c5c9';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=57, on_time=false WHERE id='6bed72ee-408a-4938-b538-c434d37fbc79';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=62, on_time=false WHERE id='fae179c7-0dd1-45b5-9661-e637b9d40df2';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=68, on_time=false WHERE id='3849391d-c1bc-46e9-b0f6-9c1f9f8609b8';

-- Liqtech International AS: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='18c222dc-0d3f-451a-afc7-1497cf7d7904';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='d4901484-bbfa-40fb-929c-14d98757e253';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='b43cc737-0b6f-4f5a-b85f-4df01902e64d';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='1c574b2b-e07f-4731-9e04-17a207409398';

-- Maxar Technologies Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='822cd75a-4495-4d1d-a9fa-82058d6a1234';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='9866a1f8-ddd6-4eae-885d-9d20ae1329ef';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='89e31e81-f073-40c9-a997-060892fc60d8';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='fe61aea9-e53d-4d5f-9aeb-30425e0aa961';

-- Mistras Group Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='e44e04fa-4e49-47a3-9f3d-bdf1674bc864';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='e04e3331-bf33-4cef-810a-13ac471167dd';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='72064115-4ba4-4b67-b232-3eb2877b69d2';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='53ed2856-79f1-4bc8-9fcf-47969ef84fa7';

-- Northgate Fabrication: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=52, on_time=false WHERE id='84464719-55c0-4560-a6fc-806870b99593';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=57, on_time=false WHERE id='783d1201-5be3-47c0-9a24-5a2c7132dfb3';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=62, on_time=false WHERE id='3d27fd36-2234-4d9c-bc0e-2fc3862c9d61';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=68, on_time=false WHERE id='ffcb2095-e369-427d-aee4-82a540c806bb';

-- Orbital Energy Group Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=52, on_time=false WHERE id='9b0ed237-bdfd-436f-a7f3-e408533d8eea';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=57, on_time=false WHERE id='fe29be77-604b-46a4-b4b9-f51f09d8da3b';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=62, on_time=false WHERE id='fe7510e5-0a25-4379-8b96-483049c2d39e';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=68, on_time=false WHERE id='93ed8e65-9a7f-4487-a901-9eed2bedf714';

-- Superior Industries International Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='46721648-168a-44fe-beb7-d2cbe967f252';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='5f32ed65-e73d-4ef0-9e47-eb731590b5ae';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='0060ab18-74ac-4539-9206-21eecfb16fdf';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='87426468-fc6d-4863-a9a9-3e16b8797fce';

-- Triumph Group Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=67, on_time=false WHERE id='8fe91491-bafb-42c4-8f1d-c1c32458287a';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=72, on_time=false WHERE id='dcd1a078-da62-4b89-9574-dd6e88480f6d';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=77, on_time=false WHERE id='70ace5e7-578e-4998-9691-16fb383f8949';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=83, on_time=false WHERE id='8beb6d80-5e18-44d8-b0e9-83a378e24019';

-- Vertex Energy Inc: delta 24.0 -> shift 24d -> stable/watch
UPDATE payment_transactions SET days_early_late=22, days_to_pay=52, on_time=false WHERE id='3253a637-1934-4646-bd8e-3c2f07160e4d';
UPDATE payment_transactions SET days_early_late=27, days_to_pay=57, on_time=false WHERE id='c79dd392-df0c-4792-92ce-180c561479f0';
UPDATE payment_transactions SET days_early_late=32, days_to_pay=62, on_time=false WHERE id='956a80b2-3640-4d7e-9546-69398db15356';
UPDATE payment_transactions SET days_early_late=38, days_to_pay=68, on_time=false WHERE id='e447d574-60f9-48cc-9e9f-17b65f3d96cf';


-- Re-check: after COMMIT, re-run backfill-payment-health.mjs to refresh customers.payment_*.
ROLLBACK;
