-- Rollback: only when the bucket is empty (reports are evidence; never delete them silently).
delete from storage.buckets where id = 'credit-reports'
  and not exists (select 1 from storage.objects where bucket_id = 'credit-reports');
