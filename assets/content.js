/* Documentation and how-to content, written once and shown by every design. */
(function () {
  const ROCIS = (window.ROCIS = window.ROCIS || {});
  ROCIS.content = {
    learn: [
      {
        id: "measure", title: "What the monitors measure",
        html: `<p>Each participating home has a Dylos DC1700 particle counter placed outside, usually on a porch or balcony. Once a minute it counts the particles in a small sample of air and reports two numbers, both as particles per 0.01 cubic foot.</p>
<dl><dt>Total particles</dt><dd>Every particle larger than about 0.5 micrometers. Smoke, traffic exhaust and cooking fumes, for instance, push this number up.</dd>
<dt>Large particles</dt><dd>Only particles larger than about 2.5 micrometers, such as dust and pollen. These are part of the total.</dd>
<dt>Small particles</dt><dd>Total minus Large: particles between about 0.5 and 2.5 micrometers. Choose Small under Particles to see it.</dd></dl>`,
      },
      {
        id: "airshed", title: "One region, one airshed",
        html: `<p>Look at all the monitors together and you will see them rise and fall at the same time. Southwestern Pennsylvania shares one airshed: when the weather traps pollution, such as during a morning inversion, air gets worse across the whole region, on hilltops and in valleys alike. Differences between neighborhoods are real but usually smaller than the swings everyone shares. The log scale makes this easy to see.</p>
<p>Most of our exposure to outdoor pollution happens while we are indoors, because that is where we spend most of our time. Outdoor air is hard for one household to change, but there is a lot you can do to protect the air inside your home. That is what ROCIS helps participants learn.</p>`,
      },
      {
        id: "names", title: "Reading a monitor name",
        html: `<p>Every monitor is named so nobody can tell which home it belongs to. A name like <b>3217_O_SQHL</b> has three parts:</p>
<dl><dt>3217</dt><dd>The hash ID, a random number that stands in for the home. It stays the same each time a home takes part.</dd>
<dt>O</dt><dd>Outdoor monitor.</dd><dt>SQHL</dt><dd>The neighborhood code, here Squirrel Hill. Homes outside Pennsylvania add the state, as in MEBA_ME.</dd></dl>
<p>Look up any code on the <a href="#neighborhoods">Neighborhoods</a> page.</p>`,
      },
      {
        id: "words", title: "Words on this site",
        html: `<dl><dt>Median</dt><dd>The middle value: half the readings were higher and half were lower. One very high reading barely moves it, which is why the site uses it instead of the average.</dd>
<dt>Highest hourly reading</dt><dd>Each monitor's readings are turned into one median per hour, and this is the highest of those in the chosen dates.</dd>
<dt>Middle 50%</dt><dd>The range from the 25th to the 75th percentile: the middle half of the readings.</dd>
<dt>Usual range</dt><dd>The 10th to the 90th percentile, the whiskers in the Distribution chart.</dd>
<dt>Monitors reporting</dt><dd>Monitors with at least one reading in the chosen dates.</dd>
<dt>Readings received</dt><dd>The share of expected 15-minute readings that arrived. Monitors that started late or stopped early lower it.</dd>
<dt>Compare</dt><dd>Pick up to 8 monitors to give each its own color in every chart. The others stay gray, or hide them under Other monitors.</dd>
<dt>Log scale</dt><dd>Each step up the axis is ten times the one before, so quiet days and big spikes fit on one chart.</dd></dl>
<p>Every chart and number also has an <b>i</b> button that explains it.</p>`,
      },
      {
        id: "process", title: "How the data is prepared",
        steps: [
          ["Readings are collected", "Volunteers download their monitor and upload the file through the link ROCIS sends at the start of the cohort."],
          ["Files are cleaned", "Lines that aren't readings and readings that appear twice are removed. The original files are kept unchanged."],
          ["Downloads are joined", "Each monitor's downloads are put together in time order and kept within the cohort's dates."],
          ["Minutes become 15-minute values", "Each value on this site is the average of the one-minute readings in that 15-minute window, labelled by when the window starts."],
          ["Checks run before publishing", "Missing times, unknown files or sites, and mismatched files stop the release until someone from ROCIS reviews them."],
        ],
      },
      {
        id: "limits", title: "Limits of this data",
        html: `<p>These monitors are good at showing when and where outdoor air changes. They are not as precise as the regulatory monitors behind official air quality reports.</p>
<dl><dt>Counts, not concentrations</dt><dd>The monitors count particles. Official reports such as the Air Quality Index use the mass of particles in micrograms per cubic meter, so the two can't be compared directly.</dd>
<dt>No humidity correction</dt><dd>Fog and very humid air can make particles look bigger and raise the counts. These readings are not adjusted for it.</dd>
<dt>Gaps and short spikes</dt><dd>Gaps happen when a monitor is unplugged or between downloads. One very high reading can come from something nearby, like a grill or a passing truck.</dd></dl>`,
      },
      {
        id: "dictionary", title: "Data dictionary",
        html: `<p>Each downloadable file has one row per 15 minutes and one column per monitor. Total particle files are called <b>small_N.csv</b> and large particle files <b>large_N.csv</b>, after the monitor's two channels. Small particles (total minus large) download as <b>dylos_small_N.csv</b>.</p>
<div class="doc-table"><table><thead><tr><th>Column</th><th>Meaning</th><th>Example</th></tr></thead><tbody>
<tr><td>Date/Time</td><td>Start of the 15-minute window, on the monitor's local clock</td><td>2026-10-05 14:15:00</td></tr>
<tr><td>One per monitor</td><td>Average count for the window, particles per 0.01 cubic foot. Empty means no reading.</td><td>3217_O_SQHL = 412.6</td></tr>
</tbody></table></div>`,
      },
    ],
    howto: [
      {
        id: "read", title: "Read the air timeline", audience: "Everyone",
        steps: [
          ["Pick a cohort", "Choose it from the cohort menu at the top of the page."],
          ["Look across a row", "Each row is one monitor. Darker stretches mean more particles, often in the evening and early morning."],
          ["Look down a column", "When most rows darken together, the whole region had dirtier air, usually because of the weather."],
          ["Point at a cell", "See the exact hour and that monitor's median for it."],
        ],
      },
      {
        id: "compare", title: "Compare your monitor", audience: "Participants",
        steps: [
          ["Find your hash ID", "ROCIS sends it to you when your cohort begins."],
          ["Pick it", "Open Compare and tick it, or click its row in the Monitors list. It gets its own color in every chart and the others turn gray."],
          ["Add neighbors", "Tick up to 8 monitors to compare them side by side. Choose Hide under Other monitors to see only those."],
          ["Check the Distribution chart", "If your box sits to the right of most others, your air usually had more particles."],
        ],
      },
      {
        id: "spreadsheet", title: "Use the data in a spreadsheet", audience: "Researchers",
        steps: [
          ["Download the file", "Choose Total, Large or Small under Download CSV."],
          ["Open it in Excel or Google Sheets", "The first column is the time; every other column is one monitor."],
          ["Leave empty cells empty", "An empty cell means no reading. Treating it as zero makes averages look cleaner than the air was."],
        ],
      },
    ],
  };

  /* Render helpers so each design only decides layout and styling. */
  function steps(list) {
    return `<ol class="steps">${list.map(([title, text]) => `<li><b>${title}</b><span>${text}</span></li>`).join("")}</ol>`;
  }
  ROCIS.renderLearn = (el) => {
    el.innerHTML = ROCIS.content.learn.map((s) =>
      `<section class="doc-sec" id="learn-${s.id}"><h3>${s.title}</h3>${s.html || ""}${s.steps ? steps(s.steps) : ""}</section>`).join("");
  };
  ROCIS.renderHowto = (el) => {
    el.innerHTML = ROCIS.content.howto.map((s) =>
      `<section class="doc-sec" id="howto-${s.id}"><h3>${s.title} <span class="audience">${s.audience}</span></h3>${s.intro ? `<p>${s.intro}</p>` : ""}${steps(s.steps)}${s.outro ? `<p class="outro">${s.outro}</p>` : ""}</section>`).join("");
  };
  ROCIS.renderIssues = (el, issues) => {
    el.replaceChildren();
    if (!issues.length) {
      const p = document.createElement("p");
      p.className = "issue ok";
      p.textContent = "No problems found in this cohort's files.";
      el.append(p);
      return;
    }
    const labels = { error: "Error", warning: "Needs a look", note: "Note" };
    issues.forEach((i) => {
      const row = document.createElement("div");
      row.className = `issue ${i.level}`;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = labels[i.level] || i.level;
      const text = document.createElement("span");
      text.textContent = i.message;
      row.append(tag, text);
      el.append(row);
    });
  };
})();
