import { useId, useRef } from "react";
import { MAX_NAME_LENGTH } from "../../services/gallery/validation";
import { Icon } from "../ui/Icon";
import type { QueueItem } from "./types";

interface Props {
  uploadOpen: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onFiles: (files: File[]) => void;
  queue: QueueItem[];
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/** Two big buttons (camera / camera roll), the remembered name, and a list of failed uploads. */
export function UploadBar({
  uploadOpen,
  name,
  onNameChange,
  onFiles,
  queue,
  onRetry,
  onDismiss,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const errors = queue.filter((q) => q.status === "error");
  const inFlight = queue.filter(
    (q) => q.status !== "done" && q.status !== "error",
  ).length;

  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length) onFiles(files);
  };

  if (!uploadOpen) {
    return (
      <p className="text-caption text-center mb-6">
        Opplasting er stengt – men kos deg med bildene!
      </p>
    );
  }

  return (
    <section className="mb-6 flex flex-col gap-3" aria-label="Last opp">
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          className="btn-primary px-6 py-3 duration-200 inline-flex items-center justify-center gap-2"
          onClick={() => cameraRef.current?.click()}
        >
          <Icon name="camera" className="w-5 h-5" />
          Ta bilde eller video
        </button>
        <button
          type="button"
          className="btn-secondary px-6 py-3 duration-200 inline-flex items-center justify-center gap-2"
          onClick={() => libraryRef.current?.click()}
        >
          <Icon name="image" className="w-5 h-5" />
          Velg fra kamerarullen
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pick(e.currentTarget)}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => pick(e.currentTarget)}
        />
      </div>

      <div className="flex justify-center">
        <label htmlFor={nameId} className="sr-only">
          Ditt navn (valgfritt)
        </label>
        <input
          id={nameId}
          className="input-base px-4 py-2 text-sm w-full max-w-xs text-center"
          placeholder="Ditt navn (valgfritt)"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="name"
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>

      {inFlight > 0 && (
        <p className="text-caption text-center" aria-live="polite">
          Laster opp {inFlight} {inFlight === 1 ? "fil" : "filer"}…
        </p>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-2 max-w-xl mx-auto w-full">
          {errors.map((q) => (
            <li
              key={q.localId}
              className="alert-error flex items-center gap-3 motion-safe:animate-shake"
            >
              <span className="flex-1 truncate">
                <span className="font-medium">{q.file.name}</span>: {q.error}
              </span>
              <button
                type="button"
                className="underline"
                onClick={() => onRetry(q.localId)}
              >
                Prøv igjen
              </button>
              <button
                type="button"
                aria-label="Fjern"
                onClick={() => onDismiss(q.localId)}
              >
                <Icon name="x" className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
