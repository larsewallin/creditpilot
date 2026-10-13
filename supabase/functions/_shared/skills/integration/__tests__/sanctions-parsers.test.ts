/**
 * Sanctions list parsers (_shared/onboarding/sanctions_parsers.ts), checked
 * against excerpts copied in the exact layout of each official file
 * (downloaded 2026-10-12). Names below are invented.
 */
import { describe, it, expect } from "vitest";
import { parseOfacCsv, parseEu, parseUk, parseUn, parseCsv, countryCode, ofacPersonName } from "../../../onboarding/sanctions_parsers.ts";

describe("OFAC CSV", () => {
  const sdn = [
    `9001,"PETRENKO, Ivan Olegovich",individual,"RUSSIA-EO14024",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 12 Mar 1971; nationality Russia; Gender Male."`,
    `9002,"NORTHWIND TRADING FZE",-0- ,"[IRAN] [IFSR]",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- `,
    `9003,"SEA BREEZE",vessel,"IRAN",-0- ,-0- ,"Crude Oil Tanker",-0- ,-0- ,"Panama",-0- ,-0- `,
    "\u001a",
  ].join("\r\n");
  const alt = `9001,1,"aka","PETRENKO, Ivan",-0- \r\n9002,2,"fka","NORTH WIND GENERAL TRADING LLC",-0- `;
  const add = `9002,3,"Office 12","Dubai","United Arab Emirates",-0- \r\n9001,4,-0- ,"Moscow","Russia",-0- `;
  const out = parseOfacCsv(sdn, alt, add);
  it("keeps people and entities, skips vessels", () => {
    expect(out.map((e) => e.list_id)).toEqual(["9001", "9002"]);
  });
  it("reorders people's names, reads aliases, nationality and DOB", () => {
    expect(out[0]).toEqual({ list_id: "9001", type: "person", name: "Ivan Olegovich PETRENKO", aliases: ["Ivan PETRENKO"],
      country_code: "RU", date_of_birth: "12 Mar 1971", programs: ["RUSSIA-EO14024"] });
  });
  it("takes an entity's country from its first address and splits programs", () => {
    expect(out[1]).toMatchObject({ type: "entity", country_code: "AE", aliases: ["NORTH WIND GENERAL TRADING LLC"], programs: ["IRAN", "IFSR"] });
  });
});

describe("EU FSF XML", () => {
  const xml = `<?xml version="1.0"?><export xmlns="http://eu.europa.ec/fpi/fsd/export">
    <sanctionEntity designationDetails="" unitedNationId="" euReferenceNumber="EU.9.1" logicalId="9">
      <regulation programme="RUS" logicalId="1"/>
      <subjectType code="person" classificationCode="P"/>
      <nameAlias firstName="Anna" middleName="" lastName="Kovacs" wholeName="Anna Kovacs" strong="true" logicalId="2"/>
      <nameAlias firstName="" middleName="" lastName="" wholeName="Anna Kovach &amp; Co" strong="true" logicalId="3"/>
      <citizenship region="" countryIso2Code="00" countryDescription="UNKNOWN" logicalId="4"/>
      <citizenship region="" countryIso2Code="RU" countryDescription="RUSSIA" logicalId="5"/>
      <birthdate circa="false" birthdate="1970-01-02" year="1970" countryIso2Code="RU" logicalId="6"/>
    </sanctionEntity>
    <sanctionEntity euReferenceNumber="EU.9.2" logicalId="10">
      <subjectType code="enterprise" classificationCode="E"/>
      <nameAlias wholeName="Steppe Minerals LLP" strong="true" logicalId="7"/>
      <address city="" countryIso2Code="KZ" countryDescription="KAZAKHSTAN" logicalId="8"/>
    </sanctionEntity></export>`;
  it("reads people and enterprises with country, DOB, programme and decoded aliases", () => {
    expect(parseEu(xml)).toEqual([
      { list_id: "EU.9.1", type: "person", name: "Anna Kovacs", aliases: ["Anna Kovach & Co"], country_code: "RU", date_of_birth: "1970-01-02", programs: ["RUS"] },
      { list_id: "EU.9.2", type: "entity", name: "Steppe Minerals LLP", aliases: [], country_code: "KZ", date_of_birth: undefined, programs: [] },
    ]);
  });
});

describe("UK Sanctions List XML", () => {
  const xml = `<Designations><Designation><UniqueID>RUS9999</UniqueID>
      <Names>
        <Name><Name1>Pavel</Name1><Name2>Igorevich</Name2><Name6>SOKOLOV</Name6><NameType>Primary Name</NameType></Name>
        <Name><Name1>Pavel</Name1><Name6>Sokolov</Name6><NameType>Primary name variation</NameType></Name>
        <Name><Name6>Falcon</Name6><NameType>Alias</NameType><AliasStrength>Low quality a.k.a</AliasStrength></Name>
      </Names>
      <RegimeName>The Russia (Sanctions) (EU Exit) Regulations 2019</RegimeName>
      <IndividualEntityShip>Individual</IndividualEntityShip>
      <IndividualDetails><Individual><DOBs><DOB>dd/mm/1966</DOB></DOBs><Nationalities><Nationality>Russia</Nationality></Nationalities></Individual></IndividualDetails>
    </Designation>
    <Designation><UniqueID>RUS9998</UniqueID><Names><Name><Name6>BLUE OCEAN</Name6><NameType>Primary Name</NameType></Name></Names>
      <IndividualEntityShip>Ship</IndividualEntityShip></Designation></Designations>`;
  it("builds full names, drops low-quality aliases and ships, reads nationality and birth year", () => {
    expect(parseUk(xml)).toEqual([{ list_id: "RUS9999", type: "person", name: "Pavel Igorevich SOKOLOV", aliases: ["Pavel Sokolov"],
      country_code: "RU", date_of_birth: "1966", programs: ["The Russia (Sanctions) (EU Exit) Regulations 2019"] }]);
  });
});

describe("UN consolidated XML", () => {
  const xml = `<CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>OMAR</FIRST_NAME><SECOND_NAME>FARID</SECOND_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE><REFERENCE_NUMBER>QDi.999</REFERENCE_NUMBER>
      <NATIONALITY><VALUE>Syrian Arab Republic</VALUE></NATIONALITY>
      <INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Omar Fareed</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY>Low</QUALITY><ALIAS_NAME>Abu Omar</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1980</YEAR></INDIVIDUAL_DATE_OF_BIRTH>
    </INDIVIDUAL></INDIVIDUALS><ENTITIES><ENTITY><DATAID>2</DATAID><FIRST_NAME>DESERT FRONT</FIRST_NAME><UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
      <REFERENCE_NUMBER>QDe.999</REFERENCE_NUMBER><ENTITY_ALIAS><QUALITY>a.k.a.</QUALITY><ALIAS_NAME>Front of the Desert</ALIAS_NAME></ENTITY_ALIAS>
      <ENTITY_ADDRESS><COUNTRY>Yemen</COUNTRY></ENTITY_ADDRESS></ENTITY></ENTITIES></CONSOLIDATED_LIST>`;
  it("reads individuals and entities, dropping low-quality aliases", () => {
    expect(parseUn(xml)).toEqual([
      { list_id: "QDi.999", type: "person", name: "OMAR FARID", aliases: ["Omar Fareed"], country_code: "SY", date_of_birth: "1980", programs: ["Al-Qaida"] },
      { list_id: "QDe.999", type: "entity", name: "DESERT FRONT", aliases: ["Front of the Desert"], country_code: "YE", programs: ["Al-Qaida"] },
    ]);
  });
});

describe("helpers", () => {
  it("parses quoted CSV with commas and doubled quotes", () => {
    expect(parseCsv(`1,"A, B ""C""",x\r\n2,y,z`)).toEqual([["1", 'A, B "C"', "x"], ["2", "y", "z"]]);
  });
  it("maps the country names the lists use", () => {
    expect(["Korea, North", "Türkiye", "Iran (Islamic Republic of)", "Congo, Democratic Republic of the", "Region: Crimea"].map(countryCode))
      .toEqual(["KP", "TR", "IR", "CD", "UA"]);
    expect(countryCode("Region: Kashmir")).toBe(undefined);
  });
  it("puts OFAC surnames last", () => {
    expect(ofacPersonName("AL-MASRI, Abu Hafs")).toBe("Abu Hafs AL-MASRI");
  });
});
