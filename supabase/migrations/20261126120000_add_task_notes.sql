-- Free-form notes on a task or event (a packing list, a door code, anything the
-- user wants to remember with it). Null when there are none. Capped so one
-- task can't hold an unbounded amount of text.
alter table tasks
  add column notes text
  check (notes is null or char_length(notes) <= 5000);
