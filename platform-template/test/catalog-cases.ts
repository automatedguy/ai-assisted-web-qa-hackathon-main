import type { QaIssue } from '../src/issues.js';

// Test oracle only. Production discovery/checks never import the practice catalog.
const cases: Array<[number, string, QaIssue['category'][], RegExp]> = [
  [1,'Starter currency',['locale_rules','formatting'],/\$9\.99/],
  [2,'Preferred cloud-storage term',['terminology'],/Almacenaje en la nube/i],
  [3,'Missing free-trial qualifier',['translation_quality'],/Obtén una prueba de 30 días/],
  [4,'Annual cancellation restriction',['translation_quality'],/al finalizar el periodo anual/],
  [5,'Business capacity',['translation_quality'],/Business[^\n]*1 TB/],
  [6,'Wrong Business link destination',['links'],/Ver Business en la tabla/],
  [7,'Wrong image product identity',['media'],/NimbusSync/],
  [8,'Singular generated count',['spelling_grammar'],/1 archivos/],
  [9,'English empty state',['locale_rules'],/No files match your search/],
  [10,'English mobile menu name',['locale_rules'],/Close menu/],
  [11,'Sorted visible dates',['formatting'],/09\/(28|29|30)\/2026|10\/01\/2026/],
  [12,'Encryption image claim',['media','translation_quality'],/solo durante la transferencia/],
  [13,'English mobile creative',['media','locale_rules'],/workspace-mobile\.png/],
  [14,'Team currency',['locale_rules','formatting'],/\$19\.99/],
  [15,'Business currency',['locale_rules','formatting'],/\$39\.99/],
  [16,'Forbidden price wording',['brand_voice','terminology'],/baratos/],
  [17,'Broken all-plans link',['links'],/planes-antiguos\.html/],
  [18,'Static US date',['formatting'],/03\/14\/2026/],
  [19,'Slang greeting',['brand_voice','terminology'],/tío|mola muchísimo/],
  [20,'Missing hero alt',['media'],/hero\.png[\s\S]*alt attribute is absent/],
  [21,'Product agreement',['spelling_grammar'],/Nuestro producto son fantástico y rápido/],
  [22,'Translated protected name',['terminology'],/SincronizaciónNimbus/],
  [23,'Imperial product weight',['locale_rules','formatting'],/2\.2 libras/],
  [24,'English team alt',['media','locale_rules'],/Team photo/],
  [25,'English subtitle cues',['media','locale_rules'],/Welcome to Nimbus|Meet our team|We keep your files safe/],
];
export function catalogReport(issues: QaIssue[]) {
  const results = cases.map(([number,title,categories,evidence]) => {
    const matches = issues.filter(issue => categories.includes(issue.category) && evidence.test(issue.evidence));
    return { id:'QA-'+String(number).padStart(2,'0'),title,detected:matches.length>0,issueIds:matches.map(issue=>issue.id),
      locations: matches.map(issue=>({url:issue.location.page_url,selector:issue.location.selector_or_xpath,state:issue.reproduction})) };
  });
  const dateIssues = issues.filter(issue=>issue.category==='formatting' && issue.reproduction && /09\/(28|29|30)\/2026|10\/01\/2026/.test(issue.evidence));
  const menuIssues = issues.filter(issue=>issue.category==='locale_rules' && /Close menu/.test(issue.evidence));
  return { detected:results.filter(result=>result.detected).length,total:cases.length,results,
    occurrenceChecks: { mobileMenuPages:new Set(menuIssues.map(issue=>issue.location.page_url)).size,
      sortedDateElements:new Set(dateIssues.map(issue=>issue.location.page_url+'|'+issue.location.selector_or_xpath)).size },
    note:'Case matching is an evidence-based regression aid, not automatic certification of correction quality, severity, absence of false positives or complete UI coverage.' };
}
