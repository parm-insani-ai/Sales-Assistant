// Referral capture. Referred buyers close far higher than cold leads, so this
// makes asking systematic: capture referrals (at delivery, after a sale, or any
// time) and drop them straight into the pipeline as new leads with a follow-up
// cadence started.

import * as store from "../store.js";
import { openModal, buildForm, toast } from "../components.js";
import { maybeStartCadence } from "../cadence.js";
import { esc } from "../utils.js";

// fromName: the customer giving the referrals. fromLeadId: their lead (optional).
export function openReferralCapture(fromName = "", fromLeadId = null) {
  openModal(fromName ? `Referrals from ${fromName.split(" ")[0]}` : "Add a referral", (close) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="small muted" style="margin-bottom:12px">Who does ${fromName ? esc(fromName.split(" ")[0]) : "your customer"} know that's thinking about a vehicle? Add them here and they go straight into your pipeline with a follow-up plan.</div>`;

    const fields = [];
    for (let i = 1; i <= 3; i++) {
      fields.push({ name: `name${i}`, label: `Referral ${i} — name`, value: "", half: true, placeholder: "Full name" });
      fields.push({ name: `phone${i}`, label: "Phone", value: "", type: "tel", inputmode: "tel", half: true, placeholder: "(555) 123-4567" });
    }

    const { element } = buildForm(fields, {
      submitLabel: "Add to pipeline",
      onSubmit: (data) => {
        let added = 0;
        for (let i = 1; i <= 3; i++) {
          const name = (data[`name${i}`] || "").trim();
          if (!name) continue;
          const lead = store.create("leads", {
            name,
            phone: (data[`phone${i}`] || "").trim(),
            vehicleInterest: "",
            source: "Referral",
            stage: "new",
            referredBy: fromName || "",
            notes: fromName ? `Referred by ${fromName}` : "Referral",
          });
          maybeStartCadence(lead.id);
          added++;
        }
        if (fromLeadId && added) store.update("leads", fromLeadId, { gaveReferrals: true });
        close();
        if (added) {
          toast(`${added} referral${added === 1 ? "" : "s"} added to your pipeline`, "success");
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } else {
          toast("No referrals entered", "");
        }
      },
    });
    wrap.appendChild(element);
    return wrap;
  });
}
