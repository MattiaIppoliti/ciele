import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = process.env.TABLE_LAYOUT_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const undo = () => page.getByRole("button", { name: "Undo table change", exact: true }).click();
const redo = () => page.getByRole("button", { name: "Redo table change", exact: true }).click();
const cols = () => page.locator("table col").evaluateAll(cs => cs.map(c => c.dataset.column));
const rows = () => page.locator("tbody tr").evaluateAll(rs => rs.map(r => r.dataset.tableRowId));
const head = key => page.locator("th").filter({ has: page.getByRole("button", { name: "Move " + key + " column", exact: true }) });
async function drag(source, target) {
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox(), b = await target.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  // The Flow spring continues after release; assert final geometry, not an
  // intermediate animation frame.
  await page.waitForFunction(() => {
    const table = document.querySelector("table");
    const heads = [...table.querySelectorAll("th")];
    return [...table.querySelectorAll("tbody tr")].every(row => [...row.cells].every((cell, index) => Math.abs(cell.getBoundingClientRect().left - heads[index].getBoundingClientRect().left) < 0.5));
  });
}
try {
  await page.goto(new URL("/library/websites/src-alex-website", base).href);
  await page.locator("tbody tr").nth(1).waitFor();
  await page.waitForFunction(() => document.querySelector("table")?.style.getPropertyValue("--table-width"));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const original = await cols();
  await drag(page.getByRole("button", { name: "Move document column", exact: true }), head("memories"));
  const moved = await cols();
  assert.notDeepEqual(moved, original);
  assert.equal(moved[0], original[0], "checkbox gutter stays fixed");
  assert.ok(await page.locator("table").evaluate(t => {
    const hs=[...t.querySelectorAll("th")];
    return [...t.querySelectorAll("tbody tr")].every(r=>[...r.cells].every((c,i)=>Math.abs(c.getBoundingClientRect().left-hs[i].getBoundingClientRect().left)<1));
  }), "moved headers and cells align");
  await undo(); assert.deepEqual(await cols(), original);
  await redo(); assert.deepEqual(await cols(), moved); await undo();
  await page.getByRole("button", { name: "Move site column", exact: true }).press("Alt+ArrowRight");
  assert.notDeepEqual(await cols(), original); await undo();
  console.log("PASS columns: pointer and keyboard reorder, alignment, undo and redo");

  const beforeRows = await rows();
  assert.equal(await page.locator('[data-slot="row-drag-handle"]').count(), 0);
  const firstCell = page.locator("tbody tr").first().locator("td").nth(1);
  await drag(firstCell, page.locator("tbody tr").nth(1).locator("td").nth(1));
  assert.deepEqual(await rows(), beforeRows, "dragging body cells cannot reorder rows");
  await firstCell.press("Alt+ArrowDown");
  assert.deepEqual(await rows(), beforeRows, "keyboard navigation cannot reorder rows");
  await firstCell.press("Escape");
  console.log("PASS rows: no drag handles; pointer and keyboard interactions preserve result order");

  const grip = page.getByRole("separator", { name: "Resize the document column", exact: true });
  const initialWidth=Number(await grip.getAttribute("aria-valuenow"));
  await grip.press("ArrowRight"); assert.ok(Math.abs(Number(await grip.getAttribute("aria-valuenow")) - (initialWidth+16)) < 1);
  await undo(); assert.ok(Math.abs(Number(await grip.getAttribute("aria-valuenow")) - initialWidth) < 1);
  await redo(); assert.ok(Math.abs(Number(await grip.getAttribute("aria-valuenow")) - (initialWidth+16)) < 1); await undo();
  await page.locator("tbody tr").nth(0).locator("td").nth(2).click({position:{x:12,y:12}});
  await page.locator("tbody tr").nth(1).locator("td").nth(3).click({modifiers:["Shift"],position:{x:12,y:12}});
  assert.equal(await page.locator('[data-cell-selected=true]').count(),4);
  await undo(); assert.equal(await page.locator('[data-cell-selected=true]').count(),1);
  await redo(); assert.equal(await page.locator('[data-cell-selected=true]').count(),4);
  await page.locator("tbody tr").nth(1).locator("td").nth(3).press("Escape");
  assert.equal(await page.locator('[data-cell-selected=true]').count(),0);
  const checkbox=page.locator('tbody [role="checkbox"]').first();
  await checkbox.click(); assert.equal(await checkbox.getAttribute("aria-checked"),"true");
  await undo(); assert.equal(await checkbox.getAttribute("aria-checked"),"false");
  await redo(); assert.equal(await checkbox.getAttribute("aria-checked"),"true"); await undo();
  console.log("PASS resize and selections: rectangular cells, escape, row checkbox and history");

  await page.goto(new URL("/alerts", base).href);
  await head("issue").locator("button").last().click();
  await page.getByRole("button",{name:"A to Z",exact:true}).click();
  assert.equal(await page.locator('th[aria-sort="ascending"]').count(),1);
  await undo(); assert.equal(await page.locator('th[aria-sort]').count(),0);
  await redo(); assert.equal(await page.locator('th[aria-sort="ascending"]').count(),1);
  await head("category").locator("button").last().click();
  await page.locator('[data-slot="popover-content"][data-open]').getByRole("button",{name:"Z to A",exact:true}).click(); await undo();
  assert.equal(await head("issue").getAttribute("aria-sort"),"ascending");
  console.log("PASS sort: undo restores the previous column and direction");

  for(const route of ["/library/faqs","/library/websites","/settings/api-keys","/settings/usage","/insights/costs"]){
    await page.goto(new URL(route,base).href);await page.locator("table").first().waitFor();
    assert.equal(await page.locator('[data-slot="row-drag-handle"]').count(), 0, route);
    assert.ok(await page.getByRole("button",{name:"Undo table change",exact:true}).count()>0);
    if(route==="/library/faqs"){
      const original=await cols();
      await page.getByRole("button",{name:"Move name column",exact:true}).press("Alt+ArrowRight");
      assert.notDeepEqual(await cols(),original);
      assert.equal(await page.locator("tbody tr").first().locator("td").count(),original.length);
      await undo();
    }
    for(const width of [390,980,1500]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,route+" at "+width+"px");
    }
  }
  assert.deepEqual(errors,[]);
  console.log("PASS Library, FAQ, Settings and Insights at mobile, tablet and desktop widths");
} finally { await browser.close(); }
