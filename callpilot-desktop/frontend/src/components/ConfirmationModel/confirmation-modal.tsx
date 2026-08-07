import React from 'react';

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
}

export function ConfirmationModal({ onConfirm, onCancel, text, isOpen }: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--opaline-surface-container-lowest)] rounded-xl border border-[var(--opaline-outline-variant)] p-6 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-xl font-semibold text-[var(--opaline-on-surface)] mb-4">Confirm Delete</h2>
        <p className="text-[var(--opaline-on-surface-variant)] mb-6">{text}</p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-[var(--opaline-on-surface-variant)] bg-[var(--opaline-surface-container-low)] hover:bg-[var(--opaline-surface-container)] rounded-md transition-colors focus-ring"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-danger text-background hover:brightness-95 rounded-md transition-colors focus-ring"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
