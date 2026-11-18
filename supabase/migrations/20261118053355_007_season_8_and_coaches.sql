with t as (select id from public.seasons where number=8)
insert into public.season_table_snapshots(season_id,club_id,club_name,position,played,won,drawn,lost,goals_for,goals_against,points,final_rank)
select t.id,v.* from t cross join (values (2,'Triciclo Juniors',1,9,6,2,1,14,6,20,3),(1,'Deportivo Athuel',2,9,5,2,2,14,6,17,1),(6,'CSYD Villa Revol',3,9,5,2,2,7,4,17,5),(3,'Chaco City',4,9,4,4,1,11,5,16,2),(5,'Parque Siquiman',5,9,5,1,3,9,6,16,6),(9,'Central Yofre',6,9,4,2,3,5,6,14,4),(8,'Sportivo General Bustos',7,9,2,4,3,7,7,10,7),(7,'CA Villa Turca',8,9,2,0,7,3,10,6,8),(4,'CA Red Point',9,9,1,2,6,3,14,5,9),(10,'Villa Allende',10,9,1,1,7,4,13,4,10)) v(c,n,p,pj,g,e,l,gf,ga,pts,fr);

with t as (select id from public.seasons where number=8)
insert into public.matches(season_id,phase,round,home_club,away_club,status,home_goals,away_goals,data_quality,legacy_key)
select t.id,'regular',v.r,v.h,v.a,'played',v.hg,v.ag,'imported',v.k from t cross join (values (1,1,2,1,2,'r1-1-2'),(1,4,8,0,0,'r1-4-8'),(1,6,5,1,0,'r1-6-5'),(1,7,10,1,0,'r1-7-10'),(1,9,3,0,1,'r1-9-3'),(2,2,7,1,0,'r2-2-7'),(2,3,4,4,0,'r2-3-4'),(2,5,1,2,1,'r2-5-1'),(2,8,6,0,0,'r2-8-6'),(2,10,9,0,1,'r2-10-9'),(3,1,8,1,0,'r3-1-8'),(3,6,3,0,0,'r3-6-3'),(3,7,5,0,2,'r3-7-5'),(3,9,4,1,0,'r3-9-4'),(3,10,2,0,1,'r3-10-2'),(4,2,9,3,0,'r4-2-9'),(4,3,1,1,1,'r4-3-1'),(4,4,6,0,2,'r4-4-6'),(4,5,10,2,0,'r4-5-10'),(4,8,7,2,0,'r4-8-7'),(5,1,4,4,1,'r5-1-4'),(5,2,5,2,1,'r5-2-5'),(5,7,3,2,0,'r5-7-3'),(5,9,6,1,0,'r5-9-6'),(5,10,8,1,3,'r5-10-8'),(6,3,10,2,2,'r6-3-10'),(6,4,7,1,0,'r6-4-7'),(6,5,9,1,0,'r6-5-9'),(6,6,1,0,2,'r6-6-1'),(6,8,2,1,3,'r6-8-2'),(7,2,3,0,0,'r7-2-3'),(7,5,8,0,0,'r7-5-8'),(7,7,6,0,1,'r7-7-6'),(7,9,1,0,0,'r7-9-1'),(7,10,4,1,0,'r7-10-4'),(8,1,7,2,0,'r8-1-7'),(8,3,5,2,0,'r8-3-5'),(8,4,2,1,1,'r8-4-2'),(8,6,10,1,0,'r8-6-10'),(8,8,9,1,1,'r8-8-9'),(9,2,6,1,2,'r9-2-6'),(9,5,4,1,0,'r9-5-4'),(9,8,3,0,1,'r9-8-3'),(9,9,7,1,0,'r9-9-7'),(9,10,1,0,2,'r9-10-1')) v(r,h,a,hg,ag,k);

with t as (select id from public.seasons where number=8)
insert into public.matches(season_id,phase,bracket_code,home_club,away_club,status,home_goals,away_goals,data_quality,legacy_key)
select t.id,v.ph::public.match_phase,v.c,v.h,v.a,'played',v.hg,v.ag,'imported',v.k from t cross join (values ('semifinal','S2',1,9,1,0,'po-S2'),('relegation','RF',10,4,0,1,'po-RF'),('final','F',3,1,1,2,'po-F'),('quarterfinal','QA',6,9,0,1,'po-QA'),('relegation','RA',8,10,2,0,'po-RA'),('quarterfinal','QB',3,5,1,0,'po-QB'),('relegation','RB',7,4,2,1,'po-RB'),('semifinal','S1',2,3,0,1,'po-S1')) v(ph,c,h,a,hg,ag,k);

with t as (select id from public.seasons where number=8)
insert into public.season_scorer_snapshots(season_id,club_id,raw_player_name,goals)
select t.id,v.c,v.n,v.g from t cross join (values (1,'Miguel Borja',9),(2,'Odsonne Edouard',9),(3,'Umar Sadiq',9),(5,'Lautaro Gutierrez',4),(1,'Leonel Flores',3)) v(c,n,g);

with t as (select id from public.seasons where number=8)
insert into public.awards(season_id,category,label,club_id,votes,value)
select t.id,v.c,v.l,v.cl,v.vo,v.va from t cross join (values
 ('mvp','Memphis Depay',null::int,3::smallint,null::numeric),('revelation','Alex Luna',null,2,null),('coach','Deportivo Athuel',1,2,null),('bettor','Nicolás Heinzmann',null,null,17914)) v(c,l,cl,vo,va);

with src(name,club,from_n) as (values ('Renato Mainero',1,8),('Tomas Romero',2,8),('Jano Gonzalez',3,8),('Nicolás Heinzmann',4,8),('Fabrizio Blanch',5,8),('Maximo Stimolo',6,9),('Valentino Rodriguez',7,8),('Benicio Calero',8,8),('Ivan Cecchin',9,8),('Facu Arenas',10,8)),
ins as (insert into public.coaches(name,data_quality) select name,'imported' from src returning id,name)
insert into public.coach_tenures(coach_id,club_id,from_season,is_current)
select i.id,s.club,se.id,true from ins i join src s on s.name=i.name join public.seasons se on se.number=s.from_n;
