-- Resume layout the template can't express:
--  * paragraphs before the first "## " heading are centered (title, contact)
--  * in Skills, the first skill after a bold "Category:" label starts with a capital letter
--  * "### Title, Company | Dates" becomes a bold title with the dates right-aligned, company on the next line
local seen = false
local section = ''
-- "**Category:** item, ..." -> capitalize the first letter of the first item.
local function capSkill(para)
  local c = para.content
  if c[1] and c[1].t == 'Strong' then
    for i = 2, #c do
      if c[i].t == 'Str' then
        c[i].text = c[i].text:gsub('^%l', string.upper)
        break
      elseif c[i].t ~= 'Space' then break end
    end
  end
  return para
end
local function div(style, inlines)
  return pandoc.Div({pandoc.Para(inlines)}, pandoc.Attr('', {}, {{'custom-style', style}}))
end
function Pandoc(doc)
  local out = {}
  for _, b in ipairs(doc.blocks) do
    if b.t == 'Header' and b.level == 2 then seen = true; section = pandoc.utils.stringify(b):lower() end
    if b.t == 'Para' and section == 'skills' then
      -- models sometimes omit the blank line between skill lines; pandoc then merges them into one paragraph
      local line = {}
      local function flush()
        if #line > 0 then out[#out+1] = capSkill(pandoc.Para(line)); line = {} end
      end
      for _, i in ipairs(b.content) do
        if i.t == 'SoftBreak' or i.t == 'LineBreak' then flush() else line[#line+1] = i end
      end
      flush()
      goto continue
    end
    if not seen and b.t == 'Para' then
      out[#out+1] = div('Center', b.content)
    elseif b.t == 'Header' and b.level == 3 then
      local text = pandoc.utils.stringify(b)
      local head, dates = text:match('^(.-)%s+|%s+([^|]+)$')
      local title, company = (head or text):match('^(.-),%s+(.+)$')
      if head and title then
        out[#out+1] = div('Job', {pandoc.Str(title), pandoc.RawInline('openxml', '<w:r><w:tab/></w:r>'), pandoc.Str(dates)})
        out[#out+1] = div('Company', {pandoc.Str(company)})
      else
        out[#out+1] = b
      end
    else
      out[#out+1] = b
    end
    ::continue::
  end
  return pandoc.Pandoc(out, doc.meta)
end
