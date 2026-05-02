REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 旧表禁止直接读写
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='admin_settings') THEN
    EXECUTE 'CREATE POLICY "deny all" ON public.admin_settings FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
