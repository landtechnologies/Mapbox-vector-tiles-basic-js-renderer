// @flow
export default resolveTokens;

/**
 * Replace tokens in a string template with values in an object
 *
 * @param properties a key/value relationship between tokens and replacements
 * @param text the template string
 * @returns the template with tokens replaced
 * @private
 */
function resolveTokens(properties: {+[string]: mixed}, text: string): string {
    return text.replace(/{([^{}]+)}/g, (match, key: string) => {
        return key in properties ? String(properties[key]) : '';
    }).replace(/FORMAT_NUMBER\(([^\)]+)\)/g, (match, key) => formatNumber(key));
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

   (12000,null,2.2) => 26K  i.e. the third argument is an optional scaling factor

   the second argument is currently unused, in future it may allow customizing of
   the formatting in some way. 
*/
function formatNumber(arg){
	arg = arg.split(","); //arg is a string, which may contain multiple arguments
	let value = parseFloat(arg[0]); 
	if(arg[2]){
		value = value*parseFloat(arg[2]);
	}
	if(value<1e3){
		return Math.round(value);
	} else if (value<1e5){
		return (value/1e3).toFixed(1) + 'K';
	} else if (value<1e6){
		return Math.round(value/1e3) + 'K';
	} else if(value<1e9){
		return (value/1e6).toFixed(2) + 'M';
	} else if(value<1e12){
		value = Math.round(value/1e6).toFixed(0);
		return value.slice(0,-3) + ',' + value.slice(-4,-1) + 'M';
	} else {
		return 'HUGE_NUM';
	}
}