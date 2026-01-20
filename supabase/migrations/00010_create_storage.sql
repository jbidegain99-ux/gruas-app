-- Create storage buckets

-- ID Documents bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('id-documents', 'id-documents', false);

-- Vehicle Documents bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-documents', 'vehicle-documents', false);

-- Storage RLS Policies for id-documents

-- Users can upload their own ID documents
CREATE POLICY "Users can upload own ID documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'id-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own ID documents
CREATE POLICY "Users can view own ID documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'id-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own ID documents
CREATE POLICY "Users can update own ID documents"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'id-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own ID documents
CREATE POLICY "Users can delete own ID documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'id-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Admins can view all ID documents
CREATE POLICY "Admins can view all ID documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'id-documents'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  )
);

-- Storage RLS Policies for vehicle-documents

-- Users can upload their own vehicle documents
CREATE POLICY "Users can upload own vehicle documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'vehicle-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own vehicle documents
CREATE POLICY "Users can view own vehicle documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vehicle-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own vehicle documents
CREATE POLICY "Users can update own vehicle documents"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'vehicle-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own vehicle documents
CREATE POLICY "Users can delete own vehicle documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'vehicle-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Admins can view all vehicle documents
CREATE POLICY "Admins can view all vehicle documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vehicle-documents'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  )
);

-- Operators can view vehicle documents for their assigned requests
CREATE POLICY "Operators can view assigned vehicle documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vehicle-documents'
  AND EXISTS (
    SELECT 1 FROM public.service_requests sr
    JOIN public.profiles p ON p.id = sr.user_id
    WHERE sr.operator_id = auth.uid()
      AND sr.vehicle_doc_path = name
  )
);
