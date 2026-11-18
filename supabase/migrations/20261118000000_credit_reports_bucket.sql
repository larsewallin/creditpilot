-- Credit providers' reports attached to a credit application (founder, 2026-11-18: the third-party
-- report is the default credit score source). A private bucket: no policies for anon or
-- authenticated, so only the onboarding function (service role) reads or writes it; people get
-- a short-lived signed link from that function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('credit-reports', 'credit-reports', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;
