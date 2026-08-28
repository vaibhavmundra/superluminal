-- ===========================================================================
-- 0002_pdf_source.sql — PDFs are a third kind of file.
--
-- `source_kind` was ('raster','vector'), written when there were exactly two
-- ways into the app. A PDF is neither: it is rasterised in the browser before
-- anything looks at it, but the object in the bucket IS a PDF, it may have
-- twenty pages, and it is re-rendered on every open. Recording it as 'raster'
-- would be a lie in the one column whose job is to say what arrived — and the
-- next person debugging a drawing set would have to unpick it.
--
-- WHICH PAGE was chosen lives in `editor_state.pdfPage` rather than in a column
-- of its own. It is read one row at a time, by the editor, at open — never
-- filtered or aggregated on — so it has no business being indexed, and a column
-- per rendering option is how a table acquires nine of them.
-- ===========================================================================

alter table public.plans drop constraint if exists plans_source_kind_check;

alter table public.plans
  add constraint plans_source_kind_check
  check (source_kind in ('raster', 'vector', 'pdf'));
