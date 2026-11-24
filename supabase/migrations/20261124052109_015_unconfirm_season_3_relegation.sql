-- Anula el descenso de Central Yofre en la temporada 3: queda sin confirmar.
update public.season_archives a set relegated_clubs = '{}'
from public.seasons s where s.id = a.season_id and s.number = 3;

update public.seasons
set notes = 'Campeón confirmado por el administrador. Descenso sin confirmar. Sin tabla, final ni partidos registrados.'
where number = 3;
