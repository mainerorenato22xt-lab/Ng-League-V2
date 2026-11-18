-- Antes de aplicar en un proyecto nuevo, reemplazar admin@example.com por el correo del administrador.
insert into private.bootstrap_admins (email) values ('admin@example.com');

insert into public.clubs (id, name, slug, founded_year, stadium, nickname) values
 (1,'Deportivo Athuel','deportivo-athuel',null,null,null),
 (2,'Triciclo Juniors','triciclo-juniors',1911,null,null),
 (3,'Chaco City','chaco-city',1918,null,null),
 (4,'CA Red Point','ca-red-point',null,null,null),
 (5,'Parque Siquiman','parque-siquiman',1968,null,null),
 (6,'CSYD Villa Revol','csyd-villa-revol',null,'Tumbalata Stadium','Villa revol'),
 (7,'CA Villa Turca','ca-villa-turca',null,null,null),
 (8,'Sportivo General Bustos','sportivo-general-bustos',1911,null,null),
 (9,'Central Yofre','central-yofre',1990,null,null),
 (10,'Villa Allende','villa-allende',null,null,null),
 (11,'Charcas Central','charcas-central',null,null,null);

insert into public.seasons (number, status, is_current, data_quality, closed_at, notes)
select n, 'closed', false, 'missing', null, 'Sin registro detallado en la web anterior' from generate_series(1,7) n;
insert into public.seasons (number, status, is_current, data_quality, closed_at)
values (8, 'closed', false, 'imported', to_timestamp(1794258335.875));
insert into public.seasons (number, status, is_current, data_quality, started_at)
values (9, 'draft', true, 'verified', null);

insert into public.season_rules (season_id, budget, star_rating)
select id, 150, 81 from public.seasons where number = 9;

insert into public.price_scales (season_id, overall, value)
select s.id, v.overall, v.value from public.seasons s
cross join (values (80,35.0),(79,30.0),(78,25.0),(77,20.0),(76,16.0),(75,13.0),(74,10.0),(73,8.0),(72,6.0),(71,4.0),(70,3.0),(69,2.0),(68,1.0),(67,0.0),(66,0.0)) v(overall, value)
where s.number = 9;

insert into public.season_clubs (season_id, club_id)
select s.id, c.id from public.seasons s join public.clubs c on c.id <= 10 where s.number = 8;
insert into public.season_clubs (season_id, club_id)
select s.id, c.id from public.seasons s join public.clubs c on c.id <= 11 where s.number = 9;

insert into public.legacy_title_totals (club_id, titles, through_season, note) values
 (3,3,7,'Total registrado en la web anterior'),(2,2,7,'Total registrado en la web anterior'),
 (1,1,7,'Total registrado en la web anterior'),(5,1,7,'Total registrado en la web anterior');

insert into public.season_archives (season_id, champion_club, runner_up_club, relegated_clubs, final_score, format_notes, source)
select id, 1, 3, array[10], 'Chaco City 1-2 Deportivo Athuel', 'Formato de descenso anterior: 7.º a 10.º con final de descenso', 'imported'
from public.seasons where number = 8;

insert into public.rivalries (club_a, club_b, name) values
 (3,8,'Derby General Bustos'),(2,3,'Superclásico'),(1,2,'Clásico del Primer Campeón'),
 (5,1,'Clásico De San Vicente'),(9,3,'Derby AR'),(10,4,'Clásico de Campo');

select setval(pg_get_serial_sequence('public.clubs','id'), 100, false);
