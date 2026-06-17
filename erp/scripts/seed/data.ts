// Realistic ACT (American Completion Tools) seed data.
// Designed for a Texas oilfield-completions / downhole-tools shop.

export const DEPARTMENTS = [
  { name: "Admin",         code: "ADM", description: "Executive leadership, HR, IT, accounting." },
  { name: "Assembly",      code: "ASM", description: "Shop-floor assembly and finishing." },
  { name: "Engineering",   code: "ENG", description: "Mechanical and design engineering." },
  { name: "Sales",         code: "SLS", description: "Outside sales and account executives." },
  { name: "InsideSales",   code: "ISL", description: "Inside sales support and customer service." },
  { name: "Manufacturing", code: "MFG", description: "CNC machining, welding, QA, maintenance." },
  { name: "Operations",    code: "OPS", description: "Operations coordination and scheduling." },
  { name: "Warehouse",     code: "WH",  description: "Inventory, shipping, receiving." },
] as const;

export const JOB_CODES = [
  { code: "ACT001",     title: "General Labor",            rate: "$22.00/hr", isDefault: true },
  { code: "AUTO001",    title: "Auto-Generated (Salaried)", rate: "NA" },
  { code: "OFFICE",     title: "Office / Administrative",  rate: "$28.00/hr" },
  { code: "ENG-MECH",   title: "Mechanical Engineering",   rate: "$42.00/hr" },
  { code: "ENG-DSGN",   title: "Design Engineering",       rate: "$40.00/hr" },
  { code: "PROD-CNC",   title: "CNC Machining",            rate: "$28.00/hr" },
  { code: "PROD-WLD",   title: "Welding",                  rate: "$32.00/hr" },
  { code: "PROD-QA",    title: "Quality Assurance",        rate: "$30.00/hr" },
  { code: "MFG-ASM",    title: "Assembly",                 rate: "$24.00/hr" },
  { code: "MFG-MAINT",  title: "Maintenance",              rate: "$30.00/hr" },
  { code: "WS-FE",      title: "Field Engineer",           rate: "$48.00/hr" },
  { code: "WS-OP",      title: "Tool Operator",            rate: "$36.00/hr" },
  { code: "WS-LE",      title: "Lead Engineer",            rate: "$55.00/hr" },
  { code: "WH-SHP",     title: "Shipping & Receiving",     rate: "$22.00/hr" },
  { code: "WH-INV",     title: "Inventory Control",        rate: "$24.00/hr" },
  { code: "SALES-AE",   title: "Account Executive",        rate: "$35.00/hr + comm" },
  { code: "SALES-SE",   title: "Sales Engineer",           rate: "$42.00/hr" },
  { code: "TRAVEL",     title: "Travel Time",              rate: "$20.00/hr" },
  { code: "TRAINING",   title: "Training / Certification", rate: "$20.00/hr" },
  { code: "SAFETY",     title: "Safety Stand-down",        rate: "$22.00/hr" },
] as const;

/** The 8 named test users — credentials printed at the end of the seed run. */
export const NAMED_USERS = [
  { name: "Marcus Holloway",       email: "marcus.holloway@actools.com",   password: "Holloway$2026",  roles: ["admin"],            department: "Admin",         jobTitle: "VP Operations",         employmentType: "FULL_PART_TIME",  compensationType: "MONTHLY_SALARY", compensationValue: 14000, gender: "MALE",   primaryJobCode: "AUTO001"  },
  { name: "Jennifer Walsh",        email: "jennifer.walsh@actools.com",    password: "Walsh$2026",     roles: ["admin"],            department: "Admin",         jobTitle: "Director of HR",        employmentType: "FULL_PART_TIME",  compensationType: "MONTHLY_SALARY", compensationValue: 11000, gender: "FEMALE", primaryJobCode: "OFFICE"   },
  { name: "Diego Ramirez",         email: "diego.ramirez@actools.com",     password: "Ramirez$2026",   roles: ["admin", "employee"], department: "Operations",    jobTitle: "Plant Manager",         employmentType: "FULL_PART_TIME",  compensationType: "MONTHLY_SALARY", compensationValue: 12000, gender: "MALE",   primaryJobCode: "AUTO001"  },
  { name: "Brianna Patterson",     email: "brianna.patterson@actools.com", password: "Patterson$2026", roles: ["employee"],         department: "Assembly",      jobTitle: "Assembly Supervisor",   employmentType: "FULL_PART_TIME",  compensationType: "MONTHLY_SALARY", compensationValue: 9500,  gender: "FEMALE", primaryJobCode: "MFG-ASM"  },
  { name: "Christopher Lambert",   email: "chris.lambert@actools.com",     password: "Lambert$2026",   roles: ["employee"],         department: "Engineering",   jobTitle: "Mechanical Engineer",   employmentType: "FULL_PART_TIME",  compensationType: "MONTHLY_SALARY", compensationValue: 10500, gender: "MALE",   primaryJobCode: "ENG-MECH" },
  { name: "Tyler Brennan",         email: "tyler.brennan@actools.com",     password: "Brennan$2026",   roles: ["employee"],         department: "Manufacturing", jobTitle: "Field Engineer",        employmentType: "CONTRACT_HOURLY", compensationType: "HOURLY_RATE",    compensationValue: 48,    gender: "MALE",   primaryJobCode: "PROD-CNC" },
  { name: "Devon Carter",          email: "devon.carter@actools.com",      password: "Carter$2026",    roles: ["employee"],         department: "Manufacturing", jobTitle: "Welder III",            employmentType: "CONTRACT_HOURLY", compensationType: "HOURLY_RATE",    compensationValue: 32,    gender: "MALE",   primaryJobCode: "PROD-WLD" },
  { name: "Plant Floor Kiosk",     email: "kiosk.plant@actools.com",       password: "Kiosk$Plant26",  roles: ["admin"],            department: "Operations",    jobTitle: "Service Account",       employmentType: "FULL_PART_TIME",  compensationType: "MONTHLY_SALARY", compensationValue: 0,     gender: "OTHER",  primaryJobCode: "AUTO001"  },
] as const;

/** Faker employee names — Texas / Gulf Coast mix. 40 entries. */
export const FAKER_NAMES: Array<{ name: string; gender: "MALE" | "FEMALE" }> = [
  { name: "Aaron Mitchell",     gender: "MALE"   },
  { name: "Alexis Rivera",      gender: "FEMALE" },
  { name: "Andre Bennett",      gender: "MALE"   },
  { name: "Brandon Phillips",   gender: "MALE"   },
  { name: "Carlos Mendoza",     gender: "MALE"   },
  { name: "Daniel Kowalski",    gender: "MALE"   },
  { name: "Ethan Crawford",     gender: "MALE"   },
  { name: "Garrett Nichols",    gender: "MALE"   },
  { name: "Hannah Guzman",      gender: "FEMALE" },
  { name: "Isabella Romano",    gender: "FEMALE" },
  { name: "Jacob Reyes",        gender: "MALE"   },
  { name: "Karen Whitfield",    gender: "FEMALE" },
  { name: "Kevin Boudreaux",    gender: "MALE"   },
  { name: "Luis Aguirre",       gender: "MALE"   },
  { name: "Mateo Delgado",      gender: "MALE"   },
  { name: "Megan Donovan",      gender: "FEMALE" },
  { name: "Natalie Cruz",       gender: "FEMALE" },
  { name: "Olivia Bryant",      gender: "FEMALE" },
  { name: "Patrick O'Connell",  gender: "MALE"   },
  { name: "Rachel Kim",         gender: "FEMALE" },
  { name: "Ricardo Solis",      gender: "MALE"   },
  { name: "Samuel Vega",        gender: "MALE"   },
  { name: "Sophia Wagner",      gender: "FEMALE" },
  { name: "Trevor McKinney",    gender: "MALE"   },
  { name: "Vanessa Cole",       gender: "FEMALE" },
  { name: "Xavier Castillo",    gender: "MALE"   },
  { name: "Yolanda Reyes",      gender: "FEMALE" },
  { name: "Zach Halverson",     gender: "MALE"   },
  { name: "Amanda Beasley",     gender: "FEMALE" },
  { name: "Brent Cavanaugh",    gender: "MALE"   },
  { name: "Cassandra Wynn",     gender: "FEMALE" },
  { name: "Derek Tanaka",       gender: "MALE"   },
  { name: "Elena Marquez",      gender: "FEMALE" },
  { name: "Felix Cardenas",     gender: "MALE"   },
  { name: "Grace Pemberton",    gender: "FEMALE" },
  { name: "Hector Villanueva",  gender: "MALE"   },
  { name: "Iris Townsend",      gender: "FEMALE" },
  { name: "Jamal Carrington",   gender: "MALE"   },
  { name: "Krista Donnelly",    gender: "FEMALE" },
  { name: "Logan Easterbrook",  gender: "MALE"   },
];

/** Department headcount targets (must total 40 for the faker batch). */
export const DEPT_QUOTAS: Record<(typeof DEPARTMENTS)[number]["name"], number> = {
  Admin: 4,
  Assembly: 6,
  Engineering: 5,
  Sales: 4,
  InsideSales: 4,
  Manufacturing: 8,
  Operations: 4,
  Warehouse: 5,
};

/** Job-titles per department — picked at random by the seeder. */
export const TITLES_BY_DEPT: Record<string, string[]> = {
  Admin:         ["Accounting Specialist", "IT Support Lead", "Office Manager", "Onboarding/HR Specialist", "CFO"],
  Assembly:      ["Assembler II", "Lead Assembler", "Finisher"],
  Engineering:   ["Senior Engineer", "Mechanical Engineer", "Design Engineer", "Junior Engineer"],
  Sales:         ["Account Executive", "Sales Engineer", "Outside Rep"],
  InsideSales:   ["Inside Sales Rep", "Customer Service Rep", "Sales Coordinator"],
  Manufacturing: ["CNC Machinist II", "Welder III", "Maintenance Technician", "Quality Assurance Specialist"],
  Operations:    ["Operations Coordinator", "Scheduler", "Plant Manager"],
  Warehouse:     ["Warehouse Lead", "Inventory Coordinator", "Shipping & Receiving"],
};

export const TX_AREA_CODES = ["713", "281", "832", "936", "432", "405"] as const;
export const TX_CITIES = [
  { city: "Houston",  state: "TX", zips: ["77001", "77002", "77019", "77056", "77098"] },
  { city: "Katy",     state: "TX", zips: ["77449", "77494"] },
  { city: "Spring",   state: "TX", zips: ["77373", "77379"] },
  { city: "Pasadena", state: "TX", zips: ["77501", "77506"] },
  { city: "Conroe",   state: "TX", zips: ["77301", "77303"] },
  { city: "Midland",  state: "TX", zips: ["79701", "79703"] },
  { city: "Odessa",   state: "TX", zips: ["79761", "79762"] },
  { city: "Tulsa",    state: "OK", zips: ["74103", "74105"] },
];

export const HOLIDAYS_2026 = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-07-03",
  "2026-09-07", "2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25",
];
