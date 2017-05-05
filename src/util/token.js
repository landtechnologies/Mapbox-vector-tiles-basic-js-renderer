'use strict';

// @flow

module.exports = resolveTokens;

/**
 * Replace tokens in a string template with values in an object
 *
 * @param {Object} properties a key/value relationship between tokens and replacements
 * @param {string} text the template string
 * @returns {string} the template with tokens replaced
 * @private
 */
function resolveTokens(properties: {[key: string]: string}, text: string): string {
    return text
    	.replace(/{([^{}]+)}/g, (match, key: string) => key in properties ? properties[key] : '')
    	.replace(/FORMAT_NUMBER\(([^\)]+)\)/g, (match, key) => formatNumber(key));
}

/*
After tokens have been resolved, anything of the form FORMAT_NUMBER(...) will be passed
through this function, which renders numbers in a short form:
   123 => 0K
   123456 => 123K
   123456789 => 123.45M
   1234567890 => 1,234M
   123456789000 => 123,456M
   1234567890000 => HUGE_NUM
*/
function formatNumber(arg){
	let value = parseFloat(arg); // we may want to support multiple arguments, where the second specifies a formatting pattern
	if(value<1e6){
		return Math.round(value/1e3).toFixed(0) + 'K';
	} else if(value<1e9){
		return (value/1e6).toFixed(2) + 'M';
	} else if(value<1e12){
		value = Math.round(value/1e6).toFixed(0);
		return value.slice(0,-3) + ',' + value.slice(-4,-1) + 'M';
	} else {
		return 'HUGE_NUM';
	}
}