'use client';

import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { uploadPlanFile } from '@/lib/agent-client';
import { cn } from '@/lib/cn';

interface FileUploadCardProps {
  sessionId: string;
  onUploaded: (artifactId: string, filename: string, rowCount: number) => void;
}

/**
 * FileUploadCard — agent-emitted card for the user to drop their CSV/XLSX
 * project plan. Posts the file as raw binary to /api/upload (Vercel route)
 * which proxies to the Railway backend's /upload endpoint. The backend
 * parses with SheetJS and returns an artifactId.
 *
 * On successful upload, calls onUploaded(artifactId, filename, rowCount)
 * which triggers the parent Chat.tsx to send a follow-up message to the
 * agent referencing the new artifact.
 */
// Backend's enforced upload size limit. Mirror it client-side so users
// see a clean error before a 50MB file silently uploads for 10s and
// fails with a 413 from Express. Keep in sync with the
// `express.raw({ type: 'star/star', limit: '10mb' })` middleware in
// agent/src/index.ts (the actual `type` value is the wildcard MIME
// pattern — written out here in words because the literal characters
// would terminate this comment block).
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/** Allowed file extensions — mirrors the `accept` attribute and the
 * SheetJS-supported types we handle on the backend. */
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadCard({ sessionId, onUploaded }: FileUploadCardProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{
    filename: string;
    rowCount: number;
    columns: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setError(null);

    // Client-side validation: extension and size BEFORE the upload starts.
    // Without these, the backend's express.raw() limit produces a silent
    // 10-second hang followed by a generic 413, and a wrong filetype lets
    // SheetJS surface a confusing "no sheets found" parse error after the
    // round trip. Both feel broken from the user's perspective.
    if (!hasAllowedExtension(file.name)) {
      setError(
        `Unsupported file type. Plansync accepts ${ALLOWED_EXTENSIONS.join(', ')}.`
      );
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError(
        `File is ${formatBytes(file.size)} — the maximum is ${formatBytes(
          MAX_UPLOAD_SIZE_BYTES
        )}. Please trim the file or split the plan into smaller pieces.`
      );
      return;
    }

    setUploading(true);
    try {
      const result = await uploadPlanFile(sessionId, file);
      if (result.error || !result.artifactId) {
        setError(result.error ?? 'Upload failed');
        return;
      }
      setUploaded({
        filename: file.name,
        rowCount: result.rowCount ?? 0,
        columns: result.columns ?? [],
      });
      onUploaded(result.artifactId, file.name, result.rowCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  if (uploaded) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface-container-lowest border border-success/30 rounded-3xl shadow-card overflow-hidden"
      >
        <div className="p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-success text-2xl filled">
              check_circle
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-headline font-bold text-on-surface text-base mb-1">
              File uploaded
            </div>
            <div className="text-sm text-on-surface-variant mb-2 truncate">
              {uploaded.filename}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                {uploaded.rowCount} rows
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-secondary/10 text-secondary">
                {uploaded.columns.length} columns
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl shadow-card overflow-hidden"
    >
      <div className="p-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'rounded-2xl border-2 border-dashed transition-all cursor-pointer',
            'p-10 flex flex-col items-center text-center gap-3',
            dragging
              ? 'border-primary bg-primary/5 scale-[1.01]'
              : 'border-outline-variant/40 bg-surface-container-low/30 hover:border-primary/40 hover:bg-primary/5'
          )}
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-3xl">
              {uploading ? 'progress_activity' : 'cloud_upload'}
            </span>
          </div>

          <div>
            <div className="font-headline font-bold text-on-surface text-lg">
              {uploading ? 'Uploading…' : 'Drag and drop file'}
            </div>
            <div className="text-xs text-on-surface-variant mt-1">
              Supports CSV, XLSX, XLS — max 10 MB
            </div>
          </div>

          {!uploading && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className={cn(
                'mt-3 px-5 py-2.5 bg-gradient-to-r from-primary to-primary-container text-white',
                'font-headline font-bold text-sm rounded-xl shadow-card-sm',
                'hover:scale-105 active:scale-95 transition-transform',
                'flex items-center gap-2'
              )}
            >
              <span className="material-symbols-outlined text-base">attach_file</span>
              Browse Files
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleChange}
            className="hidden"
          />
        </div>

        {error && (
          <div className="mt-3 p-3 bg-error-container/30 rounded-xl text-xs text-error border border-error/20">
            {error}
          </div>
        )}
      </div>
    </motion.div>
  );
}
