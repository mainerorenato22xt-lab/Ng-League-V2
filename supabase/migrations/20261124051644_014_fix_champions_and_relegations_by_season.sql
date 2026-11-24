-- Corrige los campeones de las temporadas 5 y 6 y registra el descenso de cada temporada, según el administrador.
update public.season_archives a set champion_club = v.champ, relegated_clubs = v.rel
from (values (1, 2, array[6]), (2, 3, array[2]), (3, 3, array[9]), (4, 1, array[9]), (5, 2, array[11]), (6, 3, array[9]), (7, 5, array[9])) as v(season_number, champ, rel)
join public.seasons s on s.number = v.season_number
where a.season_id = s.id;

delete from public.legacy_relegation_totals;

update public.seasons
set notes = 'Campeón y descenso confirmados por el administrador. Sin tabla, final ni partidos registrados.'
where number between 1 and 7;
