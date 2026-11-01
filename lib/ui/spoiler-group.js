/**
 * @file Spoiler group — the collapsed drawer the Arc Manager and the
 * Knowledge popup put their spoilers in
 * @module ui/spoiler-group
 */

/**
 * A collapsed spoiler group: toggle with label, warning line, then the body.
 * wizard.js buildSpoilerSection writes the same markup for the review step,
 * on purpose in its own file: there the title is escaped text, the id is
 * derived from it and the warning is fixed; here the caller passes the id and
 * both texts as HTML. Both depend on the .story-arc-spoiler-* rules in
 * css/spoiler.css.
 * @param {string} id - Id of the content element the toggle opens
 * @param {string} label - Toggle text, inserted as HTML
 * @param {string} warningText - Warning line, inserted as HTML
 * @param {string} bodyHtml
 * @returns {string}
 */
export function buildSpoilerGroup(id, label, warningText, bodyHtml) {
    return `
    <div class="story-arc-spoiler-group">
        <div class="story-arc-spoiler-toggle" data-spoiler-target="${id}">
            <i class="fa-solid fa-chevron-right"></i>
            <span class="story-arc-spoiler-label">${label}</span>
            <i class="fa-solid fa-eye-slash story-arc-spoiler-icon"></i>
        </div>
        <div class="story-arc-spoiler-content" id="${id}">
            <div class="story-arc-spoiler-warning">
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${warningText}
            </div>
            ${bodyHtml}
        </div>
    </div>`;
}
