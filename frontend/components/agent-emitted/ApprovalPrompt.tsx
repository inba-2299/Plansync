'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import { ApiKeyCard } from './ApiKeyCard';
import { FileUploadCard } from './FileUploadCard';
import { Markdown } from '../Markdown';

interface ApprovalOption {
  label: string;
  value: string;
  description?: string;
}

interface ApprovalPromptProps {
  question: string;
  options: ApprovalOption[];
  context: string | null;
  answered: boolean;
  selectedLabel?: string;
  onSelect: (option: ApprovalOption) => void;
  // For special handling when the agent asks for an API key:
  sessionId: string;
  toolUseId: string;
  onApiKeySubmit: (apiKey: string) => void;
  // For special handling when the agent asks for a file upload:
  onFileUploaded: (artifactId: string, filename: string, rowCount: number) => void;
}

/**
 * ApprovalPrompt — agent-emitted prompt for HITL decisions.
 *
 * The ONLY blocking interaction in the chat. The agent calls
 * `request_user_approval` and the loop pauses until the user clicks an
 * option (which POSTs back as a uiAction).
 *
 * Two special cases:
 *   1. API key: question mentions "API key" and has an "enter/submit/paste"
 *      style option → render ApiKeyCard inline instead of chips.
 *   2. File upload: question mentions "upload/attach/CSV/Excel/project plan"
 *      and has an "upload/attach" style option → render FileUploadCard
 *      inline instead of chips. This is the fix for the "I clicked Upload
 *      CSV and nothing happened" UX bug — previously the button just sent
 *      a confirmation back to the agent and the user still had to find the
 *      paperclip.
 *
 * Both cases bypass the option chip flow because typing a key or picking
 * a file isn't a yes/no decision.
 */
export function ApprovalPrompt({
  question,
  options,
  context,
  answered,
  selectedLabel,
  onSelect,
  sessionId,
  onApiKeySubmit,
  onFileUploaded,
}: ApprovalPromptProps) {
  // Detect API key request: if the question mentions "API key" at all,
  // render the ApiKeyCard regardless of the option labels. We used to also
  // require at least one option label to contain enter/submit/paste/
  // provide, but different models generate different option labels:
  //   - Sonnet:  [{label: "Enter API key"}]  ← matched the old regex
  //   - Haiku:   [{label: "I have my API key ready"}, {label: "I need to find it"}]  ← didn't match
  // The card-vs-chips decision should be semantic ("is this a question
  // about entering an API key?") not lexical, and the question text is a
  // reliable signal on its own. The options are bypassed entirely when
  // the card is shown, so they don't matter for this flow.
  const isApiKeyRequest = /api.?key/i.test(question);

  // Same broadening for file upload: match on question alone. Haiku uses
  // option labels like "I'm ready to upload" which don't match upload/
  // attach/file/csv/excel, and we want the FileUploadCard to render
  // whenever the question is about uploading a file.
  const isFileUploadRequest =
    !isApiKeyRequest &&
    /upload|attach|csv|excel|xlsx|xls|project plan|spreadsheet/i.test(question);

  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  // File upload special case — render the FileUploadCard alone, no preamble.
  //
  // We used to wrap the card with a separate "Agent needs input" header
  // block (icon + label + question + context). That stacked TWO headers
  // for what should be one clean upload card: the wrapper's "Agent needs
  // input / Please upload your project plan" sat directly above the
  // FileUploadCard's OWN header "Drag and drop file / Supports CSV…".
  // Visually it read as duplicate cards.
  //
  // The Stitch design treats the upload as a single self-explanatory
  // card with no preamble. The question text is lost (we don't render
  // it anywhere here) but the card's own headline is unambiguous about
  // what's being requested. If the agent ever needs to communicate
  // additional context for an upload, it can do that via the streaming
  // text bubble before calling request_user_approval — not by stacking
  // a header on the card.
  if (isFileUploadRequest && !answered) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <FileUploadCard sessionId={sessionId} onUploaded={onFileUploaded} />
      </motion.div>
    );
  }

  if (isApiKeyRequest && !answered) {
    if (showApiKeyInput) {
      return (
        <ApiKeyCard
          onSubmit={async (apiKey) => {
            await onApiKeySubmit(apiKey);
          }}
        />
      );
    }
    // Show "click to enter" preamble first
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface-container-lowest border border-primary/30 rounded-3xl shadow-card overflow-hidden"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-primary text-base">
                key
              </span>
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-primary mb-0.5">
                Agent needs input
              </div>
              <div className="font-headline font-bold text-on-surface text-base">
                {question}
              </div>
              {context && (
                <div className="text-xs text-on-surface-variant mt-1">
                  <Markdown content={context} />
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowApiKeyInput(true)}
            className={cn(
              'w-full py-3 bg-gradient-to-r from-primary to-primary-container text-white',
              'font-headline font-bold text-sm rounded-xl shadow-card-sm',
              'hover:scale-[1.01] active:scale-[0.99] transition-all',
              'flex items-center justify-center gap-2'
            )}
          >
            <span className="material-symbols-outlined text-base">key</span>
            Enter API Key
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-surface-container-lowest rounded-3xl shadow-card overflow-hidden',
        answered ? 'border border-success/30' : 'border border-primary/30'
      )}
    >
      <div className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
              answered ? 'bg-success/10' : 'bg-primary/10'
            )}
          >
            <span
              className={cn(
                'material-symbols-outlined text-base',
                answered ? 'text-success' : 'text-primary'
              )}
            >
              {answered ? 'check_circle' : 'help'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={cn(
                'text-[10px] uppercase tracking-widest font-bold mb-0.5',
                answered ? 'text-success' : 'text-primary'
              )}
            >
              {answered ? 'Answered' : 'Agent needs your input'}
            </div>
            <div className="font-headline font-bold text-on-surface text-base">
              {question}
            </div>
            {context && (
              <div className="text-xs text-on-surface-variant mt-1.5">
                <Markdown content={context} />
              </div>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {!answered ? (
            <motion.div
              key="options"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 gap-2"
            >
              {options.map((option, idx) => {
                const isPrimary =
                  idx === 0 ||
                  /approve|proceed|confirm|yes|ok|continue/i.test(option.label);
                return (
                  <motion.button
                    key={option.value}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * idx }}
                    onClick={() => onSelect(option)}
                    className={cn(
                      'group relative px-4 py-3 rounded-xl text-left transition-all',
                      'hover:scale-[1.01] active:scale-[0.99]',
                      isPrimary
                        ? 'bg-gradient-to-br from-primary to-primary-container text-white shadow-card-sm hover:shadow-card'
                        : 'bg-surface-container-low text-on-surface border border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div
                          className={cn(
                            'font-headline font-bold text-sm',
                            isPrimary ? 'text-white' : 'text-on-surface'
                          )}
                        >
                          {option.label}
                        </div>
                        {option.description && (
                          <div
                            className={cn(
                              'text-[11px] mt-0.5',
                              isPrimary ? 'text-white/80' : 'text-on-surface-variant'
                            )}
                          >
                            {option.description}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'material-symbols-outlined text-base flex-shrink-0',
                          isPrimary ? 'text-white' : 'text-on-surface-variant'
                        )}
                      >
                        arrow_forward
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="answered"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/5 border border-success/20"
            >
              <span className="material-symbols-outlined text-success text-base">
                done_all
              </span>
              <span className="text-sm text-on-surface">
                You selected:{' '}
                <strong className="font-bold text-on-surface">{selectedLabel}</strong>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
