import { describe, expect, it } from "vitest";
import type { GeographicCandidate } from "@/services/place-provider";
import { fallbackGeographicQueries, resolveCorridorGeographicCandidates, resolveGeographicCandidates } from "./geographic-resolution";

const candidate = (id:string,name:string,categories:string[],address="Japan",resultType="amenity"):GeographicCandidate => ({ name, formattedAddress:address, latitude:35, longitude:135, provider:"geoapify", providerPlaceId:id, categories, resultType });

describe("bounded geographic reference resolution",()=>{
  it("adds bounded administrative provider queries only for unresolved bare Han nearby references",()=>{
    expect(fallbackGeographicQueries("博多","place","nearby_point")).toEqual(["博多区","博多市"]);
    expect(fallbackGeographicQueries("博多站","station","nearby_point")).toEqual([]);
    expect(fallbackGeographicQueries("台北市","city_area","nearby_point")).toEqual([]);
    expect(fallbackGeographicQueries("博多","place","city_area")).toEqual([]);
  });
  it("prefers station semantics and name evidence over provider order",()=>{
    const wrong=candidate("wrong","Kumamoto",["administrative.city"],"Kumamoto, Japan","city"), right=candidate("right","熊本站",["public_transport.train"],"Kumamoto Station, Japan");
    expect(resolveGeographicCandidates("熊本站",[wrong,right],"nearby_point")).toMatchObject({status:"resolved",selected:{providerPlaceId:"right"}});
  });
  it("prefers airport semantics without trip destination context",()=>{
    const wrong=candidate("wrong","Naha",["tourism.attraction"],"Taiwan"), right=candidate("right","那覇空港",["airport.international"],"Okinawa, Japan");
    expect(resolveGeographicCandidates("那霸機場",[wrong,right],"nearby_point")).toMatchObject({status:"resolved",selected:{providerPlaceId:"right"}});
  });
  it("returns ambiguity instead of picking indistinguishable candidates",()=>{
    const one=candidate("1","Central Station",["public_transport.train"]), two={...candidate("2","Central Station",["public_transport.train"]),latitude:36};
    expect(resolveGeographicCandidates("Central Station",[one,two],"nearby_point").status).toBe("ambiguous");
  });
  it("collapses nearby station entrances but keeps distant namesakes distinct",()=>{
    const one={...candidate("main-a","Taipei main station",["public_transport.train"]),latitude:25.048,longitude:121.517};
    const entrance={...candidate("main-b","Taipei main station (Taoyuan Metro)",["public_transport.train"]),latitude:25.049,longitude:121.515};
    const distant={...candidate("distant","Taipei main station",["public_transport.train"]),latitude:24.1,longitude:120.7};
    const result=resolveGeographicCandidates("台北車站",[one,entrance,distant],"nearby_point");
    expect(result.candidates).toHaveLength(2);
    expect(result.status).toBe("ambiguous");
  });
  it("does not let a shorter nearby generic place collapse the requested station",()=>{
    const generic={...candidate("generic","Taipei",[],"Taipei, Taiwan"),latitude:25.047,longitude:121.516};
    const station={...candidate("station","Taipei main station",["public_transport.train"],"Taipei, Taiwan"),latitude:25.048,longitude:121.517};
    expect(resolveGeographicCandidates("台北車站",[generic,station],"nearby_point")).toMatchObject({status:"resolved",selected:{providerPlaceId:"station"}});
  });
  it("does not select one of two geographically distant plausible stations solely by text score",()=>{
    const exact={...candidate("exact","博多駅",["public_transport.train"],"Amagasaki, Japan"),latitude:34.736,longitude:135.421};
    const translated={...candidate("translated","Hakata Station",["public_transport.train"],"Fukuoka, Japan"),latitude:33.59,longitude:130.42};
    expect(resolveGeographicCandidates("博多站",[exact,translated],"nearby_point").status).toBe("ambiguous");
  });
  it("uses another explicitly grounded corridor endpoint as a generic administrative consistency signal",()=>{
    const fukuoka={...candidate("fukuoka","Fukuoka",[],"Fukuoka, Japan","city"),latitude:33.59,longitude:130.4,region:"Fukuoka Prefecture",country:"Japan"};
    const unrelated={...candidate("mino","小倉",[],"Nikko, Tochigi, Japan","suburb"),latitude:36.6,longitude:139.7,region:"Tochigi Prefecture",country:"Japan"};
    const consistent={...candidate("kitakyushu","Kokura",[],"Kitakyushu, Fukuoka, Japan","amenity"),latitude:33.88,longitude:130.88,city:"Kitakyushu",region:"Fukuoka Prefecture",country:"Japan"};
    expect(resolveGeographicCandidates("小倉",[unrelated,consistent],"corridor",{explicitlyGroundedPeers:[fukuoka]})).toMatchObject({status:"resolved",selected:{providerPlaceId:"kitakyushu"}});
  });
  it("selects Fukuoka to Kitakyushu Kokura by pair evidence instead of isolated exact-name rank",()=>{
    const fukuoka={...candidate("fukuoka","Fukuoka",[],"Fukuoka, Japan","city"),latitude:33.59,longitude:130.4,region:"Fukuoka Prefecture",country:"Japan",confidence:1};
    const nikko={...candidate("nikko","小倉",[],"小倉, Nikkō, Tochigi Prefecture, Japan","suburb"),latitude:36.6,longitude:139.7,city:"Nikkō",region:"Tochigi Prefecture",country:"Japan"};
    const kokura={...candidate("kokura","Kokura",[],"Kokura, Kokura-Kita Ward, Kitakyushu, Japan","amenity"),latitude:33.88,longitude:130.88,city:"Kitakyushu",region:"Fukuoka Prefecture",country:"Japan",providerRank:0};
    expect(resolveGeographicCandidates("小倉",[nikko,kokura],"corridor")).toMatchObject({status:"resolved",selected:{providerPlaceId:"nikko"}});
    const result=resolveCorridorGeographicCandidates("福岡","小倉",[fukuoka],[nikko,kokura]);
    expect(result).toMatchObject({status:"resolved",origin:{providerPlaceId:"fukuoka"},destination:{providerPlaceId:"kokura"}});
    if(result.status==="resolved")expect(result.pairs[0].reasons).toEqual(expect.arrayContaining(["SAME_REGION","SAME_COUNTRY","BOUNDED_REGIONAL_SEPARATION"]));
  });
  it("preserves an explicit Kurashiki destination without requiring same-region evidence",()=>{
    const fukuoka={...candidate("fukuoka","福岡",[],"Fukuoka, Japan","city"),latitude:33.59,longitude:130.4,region:"Fukuoka Prefecture",country:"Japan"};
    const kurashiki={...candidate("kurashiki","倉敷",[],"Kurashiki, Okayama Prefecture, Japan","city"),latitude:34.58,longitude:133.77,region:"Okayama Prefecture",country:"Japan"};
    const unrelated={...candidate("other","倉敷",[],"Distant namesake, Japan","suburb"),latitude:37.5,longitude:140.5,region:"Fukushima Prefecture",country:"Japan",providerRank:8};
    expect(resolveCorridorGeographicCandidates("福岡","倉敷",[fukuoka],[unrelated,kurashiki])).toMatchObject({status:"resolved",destination:{providerPlaceId:"kurashiki"}});
  });
  it("uses explicit administrative qualifiers as endpoint evidence",()=>{
    const fukuoka={...candidate("fukuoka","福岡",[],"Fukuoka, Japan","city"),latitude:33.59,longitude:130.4,region:"Fukuoka Prefecture",country:"Japan"};
    const qualified={...candidate("qualified","北九州市小倉",[],"Kokura, Kitakyushu, Fukuoka Prefecture, Japan","city"),latitude:33.88,longitude:130.88,city:"Kitakyushu",region:"Fukuoka Prefecture",country:"Japan"};
    const unrelated={...candidate("unrelated","小倉",[],"Nikkō, Tochigi Prefecture, Japan","suburb"),latitude:36.6,longitude:139.7,region:"Tochigi Prefecture",country:"Japan"};
    expect(resolveCorridorGeographicCandidates("福岡","北九州市小倉",[fukuoka],[unrelated,qualified])).toMatchObject({status:"resolved",destination:{providerPlaceId:"qualified"}});
  });
  it("returns pair ambiguity when two cross-country combinations remain equally supported",()=>{
    const originUs={...candidate("origin-us","Springfield",[],"Springfield, United States","city"),latitude:39.8,longitude:-89.6,region:"Illinois",country:"United States"};
    const originUk={...candidate("origin-uk","Springfield",[],"Springfield, United Kingdom","city"),latitude:55.9,longitude:-3.1,region:"Scotland",country:"United Kingdom"};
    const destinationUs={...candidate("destination-us","Riverside",[],"Riverside, United States","city"),latitude:41,longitude:-90,region:"Illinois",country:"United States"};
    const destinationUk={...candidate("destination-uk","Riverside",[],"Riverside, United Kingdom","city"),latitude:56.1,longitude:-3.2,region:"Scotland",country:"United Kingdom"};
    expect(resolveCorridorGeographicCandidates("Springfield","Riverside",[originUs,originUk],[destinationUs,destinationUk])).toMatchObject({status:"ambiguous",reason:"MULTIPLE_PLAUSIBLE_CORRIDOR_PAIRS"});
  });
  it("does not let an unrelated trip destination override an explicit corridor pair",()=>{
    const fukuoka={...candidate("fukuoka","福岡",[],"Fukuoka, Japan","city"),latitude:33.59,longitude:130.4,region:"Fukuoka Prefecture",country:"Japan"};
    const kokura={...candidate("kokura","Kokura",[],"Kitakyushu, Fukuoka Prefecture, Japan","city"),latitude:33.88,longitude:130.88,region:"Fukuoka Prefecture",country:"Japan",providerRank:0};
    const ishigaki={...candidate("ishigaki","Ishigaki",[],"Ishigaki, Okinawa, Japan","city"),latitude:24.34,longitude:124.16,region:"Okinawa Prefecture",country:"Japan"};
    expect(resolveCorridorGeographicCandidates("福岡","小倉",[fukuoka],[kokura],{tripDestination:ishigaki})).toMatchObject({status:"resolved",origin:{providerPlaceId:"fukuoka"},destination:{providerPlaceId:"kokura"}});
  });
  it("keeps trip destination context weaker than explicit geographic name evidence",()=>{
    const explicit={...candidate("explicit","Springfield",[],"Springfield, United States","city"),latitude:39.8,longitude:-89.6,country:"United States"};
    const nearTrip={...candidate("near","Spring Field Park",[],"Oita, Japan"),latitude:33.24,longitude:131.6,country:"Japan"};
    expect(resolveGeographicCandidates("Springfield",[explicit,nearTrip],"city_area",{tripDestination:{latitude:33.24,longitude:131.6,country:"Japan"}})).toMatchObject({status:"resolved",selected:{providerPlaceId:"explicit"}});
  });
  it("returns not_found when the provider supplies no candidates",()=>{
    expect(resolveGeographicCandidates("Missing place",[],"corridor")).toEqual({status:"not_found",candidates:[]});
  });
  it.each([
    ["Kokura", "Fukuoka Prefecture", "Kokura-Kita Ward"],
    ["北九州市小倉", "Fukuoka Prefecture", "北九州市小倉"],
    ["小倉", "Fukuoka Prefecture", "Kokura"],
    ["長崎", "Fukuoka Prefecture", "長崎"],
    ["板橋", "Taipei City", "板橋"],
  ])("keeps explicit corridor geography provider-backed for %s",(query,peerRegion,expectedName)=>{
    const peer={...candidate("peer","Origin",[],`${peerRegion}, Japan`,`city`),latitude:33.6,longitude:130.4,region:peerRegion,country:peerRegion==="Taipei City"?"Taiwan":"Japan"};
    const expected={...candidate("expected",expectedName,[],`${expectedName}, ${peerRegion}`,"city"),latitude:33.9,longitude:130.9,region:peerRegion,country:peer.country};
    const namesake={...candidate("namesake",query,[],`${query}, unrelated region`,"city"),latitude:36.6,longitude:139.7,region:"Unrelated",country:peer.country};
    expect(resolveGeographicCandidates(query,[namesake,expected],"corridor",{explicitlyGroundedPeers:[peer]})).toMatchObject({status:"resolved",selected:{providerPlaceId:"expected"}});
  });
});
