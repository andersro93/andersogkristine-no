import { useState } from "react";

interface Guest {
  id: string;
  name: string;
  rsvp?: string;
  allergies?: string;
}

interface Invite {
  id: string;
  name: string;
  guests: Guest[];
}

interface GuestFormState {
  rsvp: string;
  allergies: string;
}

type FormState = Record<string, GuestFormState>;

type SubmitStatus = "idle" | "loading" | "success" | "error";

interface Props {
  invite: Invite;
}

export default function RSVPForm({ invite }: Props) {
  const [formState, setFormState] = useState<FormState>(() =>
    Object.fromEntries(
      invite.guests.map((g) => [
        g.id,
        { rsvp: g.rsvp ?? "", allergies: g.allergies ?? "" },
      ]),
    ),
  );
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [allDeclined, setAllDeclined] = useState(false);

  function updateGuest(id: string, field: keyof GuestFormState, value: string) {
    setFormState((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitStatus("loading");
    setErrorMsg("");

    const guests = invite.guests.map((g) => ({
      id: g.id,
      rsvp: formState[g.id]?.rsvp ?? "",
      allergies: formState[g.id]?.allergies ?? "",
    }));

    const declined = guests.every((g) => g.rsvp !== "Kommer");
    setAllDeclined(declined);

    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guests }),
      });
      const result = (await res.json()) as { success: boolean; error?: string };
      if (res.ok && result.success) {
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
      <div className="text-center py-10 space-y-6 animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-title/10 text-brand-title mx-auto mb-4">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <title>Success Icon</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <h3 className="font-wedding text-4xl text-brand-title">
          Tusen takk for svar!
        </h3>

        <p className="font-serif italic text-lg max-w-md mx-auto leading-relaxed text-brand-text/90">
          {allDeclined
            ? "Det var veldig synd at dere ikke kan komme, men takk for at dere meldte ifra! Vi vil savne dere."
            : "Vi gleder oss utrolig mye til å feire denne store dagen sammen med dere på Tårnet Kulturarena!"}
        </p>

        <div className="w-12 h-px bg-brand-title/20 mx-auto my-6" />

        <p className="font-sans text-sm text-brand-text/70">
          Du kan når som helst endre svaret ditt ved å gå tilbake til denne
          siden med din kode.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-3 pt-4">
          <a
            href="/"
            className="bg-brand-title text-brand-bg hover:bg-brand-title/90 px-6 py-2.5 rounded-lg text-sm font-sans font-medium transition duration-200"
          >
            Til hovedsiden
          </a>
          <a
            href="/bordoppsett"
            className="border border-brand-title/20 text-brand-title hover:bg-brand-title/5 px-6 py-2.5 rounded-lg text-sm font-sans font-medium transition duration-200"
          >
            Se bordoppsett
          </a>
          <a
            href="/musikk"
            className="border border-brand-title/20 text-brand-title hover:bg-brand-title/5 px-6 py-2.5 rounded-lg text-sm font-sans font-medium transition duration-200"
          >
            Foreslå musikk
          </a>
        </div>
      </div>
    );
  }

  /* ── Form ───────────────────────────────────────────────────── */
  return (
    <div>
      <h2 className="font-serif text-3xl text-brand-title text-center mb-2">
        Velkommen, {invite.name}!
      </h2>
      <p className="font-sans text-sm text-center text-brand-text/70 mb-10">
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
                  <span className="font-serif text-xl text-brand-title font-medium">
                    {guest.name}
                  </span>
                  <span className="text-xs tracking-wider uppercase px-2.5 py-1 rounded bg-brand-title/10 text-brand-title font-medium">
                    Gjest {idx + 1}
                  </span>
                </div>

                {/* Attendance */}
                <div className="space-y-2">
                  <p className="block text-xs font-semibold uppercase tracking-wider text-brand-title opacity-95">
                    Kommer du?
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(["Kommer", "Kommer ikke"] as const).map((option) => (
                      <label
                        key={option}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition select-none ${
                          state?.rsvp === option
                            ? "border-brand-title/40 bg-brand-title/5"
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
                          onChange={() => updateGuest(guest.id, "rsvp", option)}
                          className="w-4 h-4 text-brand-title focus:ring-brand-title border-brand-title/20"
                        />
                        <span className="text-sm font-medium text-brand-title">
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
                      ? "max-h-40 opacity-100"
                      : "max-h-0 opacity-0 pointer-events-none"
                  }`}
                >
                  <label
                    htmlFor={`allergies-${guest.id}`}
                    className="block text-xs font-semibold uppercase tracking-wider text-brand-title opacity-95"
                  >
                    Allergier / Mathensyn
                  </label>
                  <input
                    type="text"
                    id={`allergies-${guest.id}`}
                    placeholder="F.eks. Gluten, vegetar, ingen"
                    value={state?.allergies ?? ""}
                    onChange={(e) =>
                      updateGuest(guest.id, "allergies", e.target.value)
                    }
                    className="w-full px-4 py-2.5 rounded-lg border border-brand-title/15 bg-white text-brand-title focus:outline-none focus:ring-2 focus:ring-brand-title/50 text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Error */}
        {submitStatus === "error" && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
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
              <svg
                className="animate-spin h-5 w-5 text-brand-bg"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <title>Loading Spinner</title>
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
