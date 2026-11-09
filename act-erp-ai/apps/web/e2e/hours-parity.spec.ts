import { test, expect, type Page, type Locator } from "@playwright/test";
import { db, businessYmd } from "./support/db";
import { PT, sessionFor, makeEntry as employeeEntry } from "./support/payroll-time";
import { makeAgency, makeWorker, makeEntry as contractEntry } from "./support/contract";

async function styleOf(row: Locator) {
  return row.evaluate(el => {
    const style = getComputedStyle(el);
    const firstCell = el.querySelector("td");
    const cell = firstCell ? getComputedStyle(firstCell) : null;
    const buttons = Array.from(el.querySelectorAll("[data-hours-actions] button")).map(button => {
      const s = getComputedStyle(button);
      return { text: button.textContent?.trim(), height: s.height, font: s.font, padding: s.padding, background: s.backgroundColor, color: s.color, border: s.border, radius: s.borderRadius, gap: s.gap };
    });
    return { height: el.getBoundingClientRect().height, font: style.font, padding: style.padding, border: style.border, cellPadding: cell?.padding, widths: Array.from(el.querySelectorAll("td")).slice(0,7).map(td=>td.getBoundingClientRect().width), buttons };
  });
}

test("equivalent employee and contract entries share row pixels, review controls, and mobile cards", async ({ browser }, testInfo) => {
  const context = await sessionFor(browser, "alice", PT.alice.email);
  const page = await context.newPage();
  await page.setViewportSize(testInfo.project.name === "mobile-chrome" ? {width:390,height:844} : {width:1440,height:1000});
  const employee = await db.employee.findUniqueOrThrow({where:{employeeId:PT.pat.employeeId}});
  const name = "Aleksandra Wiśniewska-Kowalczyk";
  const agency = await makeAgency({name:"North American Industrial Staffing and Technical Services"});
  const worker = await makeWorker({agencyId:agency.id,name,project:null});
  const day = businessYmd(1);
  const emp = await employeeEntry(PT.pat.employeeId,day,"09:00","17:00",{approval:"PENDING",source:"WEB"});
  const con = await contractEntry(worker.id,{daysAgo:1,in:"09:00",out:"17:00"});
  await db.employee.update({where:{id:employee.id},data:{name}});
  const range = `from=${businessYmd(3)}&to=${businessYmd(0)}`;
  const employeeUrl = `/admin/hours?${range}&employee=${employee.id}`;
  const contractUrl = `/admin/hours/contract-workers?${range}&worker=${worker.id}`;
  try {
    await page.goto(employeeUrl);
    const erow = page.locator(`[data-hours-entry="${emp.id}"]:visible`);
    await expect(erow).toBeVisible();
    const employeeStyle = await styleOf(erow);
    expect(await page.getByRole("button",{name:"Download Excel",exact:true}).evaluate(el=>(el as HTMLButtonElement).form?.id)).toBe("employee-hours-filters");
    await erow.getByRole("button",{name:`Edit time entry for ${name}`,exact:true}).click();
    const employeeEditor=page.locator("[data-panel-open]:visible").filter({has:page.getByRole("heading",{name:"Edit time entry",exact:true})});
    const employeeControl=await employeeEditor.getByLabel("Clock in",{exact:true}).evaluate(el=>{const s=getComputedStyle(el);return {height:s.height,width:s.width,font:s.font,padding:s.padding,border:s.border,radius:s.borderRadius};});
    await employeeEditor.getByRole("button",{name:"Cancel",exact:true}).click();
    // Compare the default view after the editor workflow, independent of the
    // browser's automatic horizontal scrolling when it focuses a row action.
    await erow.evaluate(el=>{const viewport=el.closest("table")?.parentElement;if(viewport)viewport.scrollLeft=0;});
    await page.screenshot({path:testInfo.outputPath("employees.png"),fullPage:true});
    await page.goto(contractUrl);
    const crow = page.locator(`[data-hours-entry="${con.id}"]:visible`);
    await expect(crow).toBeVisible();
    expect(await styleOf(crow)).toEqual(employeeStyle);
    expect(await page.getByRole("button",{name:"Download Excel",exact:true}).evaluate(el=>(el as HTMLButtonElement).form?.id)).toBe("contract-hours-filters");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
    await page.screenshot({path:testInfo.outputPath("contract-workers.png"),fullPage:true});
    await crow.getByRole("button",{name:`Edit entry for ${name}`,exact:true}).click();
    const contractEditor=page.locator("[data-panel-open]:visible").filter({has:page.getByRole("heading",{name:"Edit time entry",exact:true})});
    expect(await contractEditor.getByLabel("Clock in",{exact:true}).evaluate(el=>{const s=getComputedStyle(el);return {height:s.height,width:s.width,font:s.font,padding:s.padding,border:s.border,radius:s.borderRadius};})).toEqual(employeeControl);
    await expect(contractEditor.getByRole("button",{name:`Delete entry for ${name}`,exact:true})).toBeVisible();
    await contractEditor.getByRole("button",{name:"Cancel",exact:true}).click();
    await page.getByRole("navigation",{name:"Hours sections"}).getByRole("link",{name:"Approvals",exact:true}).click();
    await expect(page).toHaveURL(url=>url.pathname==="/admin/hours/contract-workers/approvals");
    await expect(page.locator(`[data-hours-entry="${con.id}"]:visible`)).toBeVisible();
    await page.getByRole("navigation",{name:"Hours workforce"}).getByRole("link",{name:"Employees",exact:true}).click();
    await expect(page).toHaveURL(url=>url.pathname==="/admin/hours/approvals" && url.searchParams.get("from")===businessYmd(3));
    await expect(page.locator(`[data-hours-entry="${emp.id}"]:visible`)).toBeVisible();
    await page.goto(employeeUrl);
    await reviewRejection(page,emp.id,name);
    await expect.poll(async()=>(await db.timeEntry.findUniqueOrThrow({where:{id:emp.id}})).approvalStatus).toBe("REJECTED");
    await page.goto(contractUrl);
    await reviewRejection(page,con.id,name);
    await expect.poll(async()=>(await db.contractTimeEntry.findUniqueOrThrow({where:{id:con.id}})).approvalStatus).toBe("REJECTED");
  } finally {
    await db.timeEntry.delete({where:{id:emp.id}});
    await db.employee.update({where:{id:employee.id},data:{name:employee.name}});
    await db.contractWorker.delete({where:{id:worker.id}});
    await db.staffingAgency.delete({where:{id:agency.id}});
    await context.close();
  }
});

async function reviewRejection(page: Page, id: string, name: string) {
  const row=page.locator(`[data-hours-entry="${id}"]:visible`);
  await row.getByRole("button",{name:`Reject entry for ${name}`,exact:true}).click();
  const panel=page.locator("[data-panel-open]:visible").filter({has:page.getByRole("heading",{name:"Reject time entry",exact:true})});
  await expect(panel).toBeVisible();
  const reject=panel.getByRole("button",{name:"Reject",exact:true});
  await expect(reject).toBeDisabled();
  await panel.getByRole("textbox").fill("Hours need correction after supervisor review");
  await reject.click();
}

test("bulk approval uses the same controls and updates only selected pending entries in both workforces",async({browser},testInfo)=>{
  const context=await sessionFor(browser,"alice",PT.alice.email);
  const page=await context.newPage();
  await page.setViewportSize(testInfo.project.name==="mobile-chrome"?{width:390,height:844}:{width:1440,height:1000});
  const employee=await db.employee.findUniqueOrThrow({where:{employeeId:PT.pat.employeeId}});
  const agency=await makeAgency();
  const worker=await makeWorker({agencyId:agency.id});
  const emp=await employeeEntry(PT.pat.employeeId,businessYmd(1),"08:00","16:00",{approval:"PENDING",source:"WEB"});
  const con=await contractEntry(worker.id,{daysAgo:1});
  const range=`from=${businessYmd(3)}&to=${businessYmd(0)}`;
  try{
    for(const [url,id,name] of [[`/admin/hours/approvals?${range}&employee=${employee.id}`,emp.id,employee.name],[`/admin/hours/contract-workers/approvals?${range}&worker=${worker.id}`,con.id,worker.name]]){
      await page.goto(url);
      await page.locator(`[data-hours-entry="${id}"]:visible`).getByRole("checkbox",{name:`Select entry for ${name}`,exact:true}).check();
      await page.getByRole("button",{name:"Approve selected",exact:true}).click();
      await expect(page.locator(`[data-hours-entry="${id}"]:visible`)).toHaveCount(0);
    }
    expect((await db.timeEntry.findUniqueOrThrow({where:{id:emp.id}})).approvalStatus).toBe("APPROVED");
    expect((await db.contractTimeEntry.findUniqueOrThrow({where:{id:con.id}})).approvalStatus).toBe("APPROVED");
  }finally{
    await db.timeEntry.delete({where:{id:emp.id}});
    await db.contractWorker.delete({where:{id:worker.id}});
    await db.staffingAgency.delete({where:{id:agency.id}});
    await context.close();
  }
});
