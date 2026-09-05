import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE = "https://oeds.education.ohio.gov/DataExtract";

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;

  try {
    const response = await fetch(SOURCE, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/5.0; statewide-public-education-directory-research)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          state: "OH",
          source: SOURCE,
          blocker: `Ohio OEDS DataExtract GET returned HTTP ${response.status}`,
          districtsNewlyAttempted: 0,
        },
        { status: 502 },
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const form = $("form").first();

    const hiddenInputs = form
      .find('input[type="hidden"][name]')
      .map((_, element) => $(element).attr("name") || "")
      .get()
      .filter(Boolean);

    const controls = form
      .find("input[name], select[name], button[name]")
      .map((_, element) => {
        const node = $(element);
        const name = node.attr("name") || "";
        const value = node.attr("value") || "";
        const id = node.attr("id") || "";
        const label = clean(
          [
            node.attr("aria-label") || "",
            node.closest("label").text(),
            id ? $(`label[for="${id}"]`).text() : "",
            node.parent().text(),
          ]
            .filter(Boolean)
            .join(" "),
        ).slice(0, 220);
        return { name, id, value, type: node.attr("type") || element.tagName, label };
      })
      .get()
      .filter((control) =>
        /public district|district|role|superintendent|generate|report|first name|last name|title|email|phone/i.test(
          `${control.name} ${control.id} ${control.value} ${control.label}`,
        ),
      )
      .slice(0, 120);

    const publicDistrictControls = controls.filter((control) =>
      /public district/i.test(`${control.value} ${control.label}`),
    );
    const generateControls = controls.filter((control) =>
      /generate|report/i.test(`${control.name} ${control.id} ${control.value} ${control.label}`),
    );

    if (!form.length || !hiddenInputs.length || !publicDistrictControls.length || !generateControls.length) {
      return NextResponse.json(
        {
          ok: false,
          state: "OH",
          source: response.url || SOURCE,
          mode: "authoritative-oeds-form-probe",
          blocker: "OEDS page is reachable, but the statewide report form controls could not yet be identified with sufficient confidence; no database writes performed.",
          formFound: Boolean(form.length),
          hiddenInputCount: hiddenInputs.length,
          publicDistrictControls,
          generateControls,
          relevantControls: controls,
          districtsNewlyAttempted: 0,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      state: "OH",
      source: response.url || SOURCE,
      mode: "authoritative-oeds-form-probe",
      form: {
        action: form.attr("action") || "",
        method: (form.attr("method") || "get").toLowerCase(),
        hiddenInputs,
        publicDistrictControls,
        generateControls,
        relevantControls: controls,
      },
      next: "Submit the discovered OEDS statewide Public District role/person export in one batch; do not fall back to district-by-district retries.",
      districtsNewlyAttempted: 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        state: "OH",
        source: SOURCE,
        blocker: error instanceof Error ? error.message : String(error),
        districtsNewlyAttempted: 0,
      },
      { status: 502 },
    );
  }
}
