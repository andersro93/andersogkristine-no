import { useState } from "react";
import AllergyInput from "./AllergyInput";
import { fireConfetti } from "./ui/confetti";
import { Icon, Spinner } from "./ui/Icon";

interface Guest {
  id: string;
  name: string;
  rsvp?: string;
  allergies?: string[];
}

interface Invite {
  id: string;
  code: string;
  name: string;
  guests: Guest[];
}

interface GuestFormState {
  rsvp: string;
  allergies: string[];
}

type FormState = Record<string, GuestFormState>;

type SubmitStatus = "idle" | "loading" | "success" | "error";

interface Props {
  invite: Invite;
  allergySuggestions?: string[];
  seatingEnabled?: boolean;
  musicEnabled?: boolean;
}

export default function RSVPForm({
  invite,
  allergySuggestions = [],
  seatingEnabled = false,
  musicEnabled = false,
}: Props) {
  const [formState, setFormState] = useState<FormState>(() =>
    Object.fromEntries(
      invite.guests.map((g) => [
        g.id,
        { rsvp: g.rsvp ?? "", allergies: g.allergies ?? [] },
      ]),
    ),
  );
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [allDeclined, setAllDeclined] = useState(false);

  function setRsvp(id: string, rsvp: string) {
    setFormState((prev) => ({ ...prev, [id]: { ...prev[id], rsvp } }));
  }

  function setAllergies(id: string, allergies: string[]) {
    setFormState((prev) => ({ ...prev, [id]: { ...prev[id], allergies } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitStatus("loading");
    setErrorMsg("");

    const guests = invite.guests.map((g) => {
      const rsvp = formState[g.id]?.rsvp ?? "";
      return {
        id: g.id,
        rsvp,
        // Clear allergies for guests who are not coming, so a changed answer
        // does not leave stale tags behind in Notion.
        allergies: rsvp === "Kommer" ? (formState[g.id]?.allergies ?? []) : [],
      };
    });

    const declined = guests.every((g) => g.rsvp !== "Kommer");
    setAllDeclined(declined);

    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: invite.code, guests }),
      });
      const result = (await res.json()) as { success: boolean; error?: string };
      if (res.ok && result.success) {
        if (!declined) fireConfetti();
        setSubmitStatus("success");
      } else {
        throw new Error(result.error || "Noe gikk galt under lagring.");
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Klarte ikke å sende svar. Vennligst prøv igjen.",
      );
      setSubmitStatus("error");
    }
  }

  /* ── Success screen ─────────────────────────────────────────── */
  if (submitStatus === "success") {
    return (
      <div className="text-center py-10 space-y-6 motion-safe:animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-title/10 text-brand-title mx-auto mb-4 motion-safe:animate-pop">
          <Icon name="check" className="w-8 h-8" title="Success Icon" />
        </div>

        <h2 className="text-4xl">Tusen takk for svar!</h2>

        <p className="text-body-serif max-w-md mx-auto">
          {allDeclined
            ? "Det var veldig synd at dere ikke kan komme, men takk for at dere meldte ifra! Vi vil savne dere."
            : "Vi gleder oss utrolig mye til å feire denne store dagen sammen med dere på Tårnet Kulturarena!"}
        </p>

        <div className="w-12 h-px bg-brand-title/20 mx-auto my-6" />

        <p className="text-caption">
          Du kan når som helst endre svaret ditt ved å gå tilbake til denne
          siden med din kode.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-3 pt-4">
          <a href="/" className="btn-primary px-6 py-2.5 text-sm duration-200">
            Til hovedsiden
          </a>
          {seatingEnabled && (
            <a
              href="/bordoppsett"
              className="btn-secondary px-6 py-2.5 text-sm duration-200"
            >
              Se bordoppsett
            </a>
          )}
          {musicEnabled && (
            <a
              href="/musikk"
              className="btn-secondary px-6 py-2.5 text-sm duration-200"
            >
              Foreslå musikk
            </a>
          )}
        </div>
      </div>
    );
  }

  /* ── Form ───────────────────────────────────────────────────── */
  return (
    <div>
      <h2 className="font-serif text-3xl text-center mb-2">
        Velkommen, {invite.name}!
      </h2>
      <p className="text-caption text-center mb-10">
        Vennligst kryss av for om du/dere kan komme og fyll ut eventuelle
        detaljer.
      </p>

      <form onSubmit={handleSubmit} className="space-y-8 font-sans">
        <div className="space-y-6">
          {invite.guests.map((guest, idx) => {
            const state = formState[guest.id];
            const isAttending = state?.rsvp === "Kommer";

            return (
              <div
                key={guest.id}
                className="bg-brand-bg/40 border border-brand-title/5 rounded-xl p-6 md:p-8 space-y-6 relative transition-all duration-300"
              >
                {/* Guest title */}
                <div className="flex items-center justify-between border-b border-brand-title/10 pb-4">
                  <span className="font-serif text-xl font-medium">
                    {guest.name}
                  </span>
                  <span className="text-xs tracking-wider uppercase px-2.5 py-1 rounded bg-brand-title/10 text-brand-title font-medium">
                    Gjest {idx + 1}
                  </span>
                </div>

                {/* Attendance */}
                <div className="space-y-2">
                  <p className="text-lead block opacity-95">Kommer du?</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(["Kommer", "Kommer ikke"] as const).map((option) => (
                      <label
                        key={option}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition select-none ${
                          state?.rsvp === option
                            ? "border-brand-title/40 bg-brand-title/5 motion-safe:animate-pop"
                            : "border-brand-title/10 bg-white hover:bg-brand-bg/30"
                        }`}
                      >
                        <input
                          id={`rsvp-${guest.id}-${option}`}
                          type="radio"
                          name={`rsvp-${guest.id}`}
                          value={option}
                          required
                          checked={state?.rsvp === option}
                          onChange={() => setRsvp(guest.id, option)}
                          className="w-4 h-4 text-brand-title focus:ring-brand-title border-brand-title/20"
                        />
                        <span
                          key={`${option}-${state?.rsvp}`}
                          className={`inline-block text-sm font-medium text-brand-title ${state?.rsvp === option ? "motion-safe:animate-pop" : ""}`}
                        >
                          {option === "Kommer"
                            ? "Ja, jeg gleder meg!"
                            : "Nei, jeg kan dessverre ikke"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Allergy field — only shown when attending */}
                <div
                  className={`space-y-2 transition-all duration-300 overflow-hidden ${
                    isAttending
                      ? "max-h-[32rem] opacity-100"
                      : "max-h-0 opacity-0 pointer-events-none"
                  }`}
                >
                  <label
                    htmlFor={`allergies-${guest.id}`}
                    className="text-lead block opacity-95"
                  >
                    Allergier / Mathensyn
                  </label>
                  <p className="text-xs text-brand-title/60">
                    Legg til én ting om gangen.
                  </p>
                  <AllergyInput
                    inputId={`allergies-${guest.id}`}
                    value={state?.allergies ?? []}
                    onChange={(items) => setAllergies(guest.id, items)}
                    suggestions={allergySuggestions}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Error */}
        {submitStatus === "error" && (
          <div key={errorMsg} className="alert-error motion-safe:animate-shake">
            {errorMsg}
          </div>
        )}

        {/* Submit */}
        <div className="text-center pt-4">
          <button
            type="submit"
            disabled={submitStatus === "loading"}
            className="bg-brand-title text-brand-bg hover:bg-brand-title/95 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-title px-12 py-4 rounded-xl font-serif text-lg tracking-wider transition-all duration-300 transform hover:-translate-y-0.5 inline-flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
          >
            <span>
              {submitStatus === "loading" ? "Sender..." : "Send svar"}
            </span>
            {submitStatus === "loading" && (
              <Spinner
                className="h-5 w-5 text-brand-bg"
                title="Loading Spinner"
              />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
